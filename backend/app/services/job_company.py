"""Company facts from same-job HTML slots or bounded, inert structured data."""
import re
from html import unescape
from urllib.parse import parse_qs, urljoin, urlsplit

from app.services.extraction import PageParser, job_postings, same_job_page


def company_value(value) -> str | None:
    if not isinstance(value, str):
        return None
    name = " ".join(unescape(value).split())
    if (not name or len(name) > 200 or any(ord(char) < 32 for char in name)
            or any(char in name for char in "<>\ufffd") or re.search(r"https?://", name, re.IGNORECASE)):
        return None
    try:
        name.encode("utf-8")
    except UnicodeError:
        return None
    return name


def unique_name(values) -> str | None:
    names = {name for value in values if (name := company_value(value))}
    return next(iter(names)) if len(names) == 1 else None


def organization(item: dict):
    value = item.get("hiringOrganization")
    return value.get("name") if isinstance(value, dict) else None


def references_match(item: dict, url: str, matches) -> bool:
    for key in ("url", "@id", "mainEntityOfPage"):
        if key not in item:
            continue
        value = item[key]
        value = value.get("@id") if isinstance(value, dict) else value
        if not isinstance(value, str) or not matches(value, url):
            return False
    return True


class CompanySlotParser(PageParser):
    """Only the exact job's company-name anchor, never its recommended jobs."""
    def __init__(self, identity: str, url: str, site: str = "catch"):
        super().__init__()
        self.identity, self.url = identity, url
        self.site = site
        self.region = self.anchor = 0
        self.chunks, self.names = [], []
        self.overflow = False

    def handle_starttag(self, tag, attrs):
        previous = len(self.stack)
        super().handle_starttag(tag, attrs)
        if previous == len(self.stack) or any(skip for _, skip, _ in self.stack):
            return
        values, depth = dict(attrs), len(self.stack)
        classes = (values.get("class") or "").split()
        region_match = ((f"printArea_{self.identity}" in classes or values.get("id") == f"view3_{self.identity}")
                        if self.site == "catch" else f"company_info_wrap_{self.identity}" in classes and "jv_company" in classes)
        if not self.region and region_match:
            self.region = depth
        anchor_match = ({"name", "gtm-recruitDetail-compInfo-click"}.issubset(classes)
                        if self.site == "catch" else "company_name" in classes)
        if self.region and tag == "a" and not self.anchor and anchor_match:
            try:
                target, source = urlsplit(urljoin(self.url, values.get("href") or "")), urlsplit(self.url)
                path_match = (re.fullmatch(r"/Comp/CompSummary/[0-9]{1,20}", target.path) and not target.query
                              if self.site == "catch" else target.path == "/zf_user/company-info/view"
                              and bool(parse_qs(target.query, max_num_fields=100).get("csn")))
            except ValueError:
                return
            if (target.scheme == source.scheme and target.netloc == source.netloc
                    and path_match and not target.fragment):
                self.anchor, self.chunks = depth, []

    def handle_data(self, data):
        if self.anchor and not any(skip for _, skip, _ in self.stack):
            if sum(map(len, self.chunks)) + len(data) <= 300:
                self.chunks.append(data)
            else:
                self.overflow = True

    def handle_endtag(self, tag):
        target = next((i + 1 for i in range(len(self.stack)-1, -1, -1) if self.stack[i][0] == tag), None)
        if target is not None:
            if self.anchor >= target:
                if len(self.names) < 16:
                    self.names.append("".join(self.chunks))
                else:
                    self.overflow = True
                self.anchor = 0
            if self.region >= target:
                self.region = 0
        super().handle_endtag(tag)


def company_for_page(html: str, url: str | None, page: PageParser) -> str | None:
    if not url:
        return None
    from app.services import (
        catch_period,
        jasoseol_period,
        jobplanet_period,
        linkareer_period,
        work24_period,
    )
    if work24_period.job_id(url):
        return (unique_name(page.company_names)
                if isinstance(page, work24_period.Work24Parser) and page.verified and not page.password_form
                else None)
    if identity := catch_period.job_id(url):
        parser = catch_period.CatchParser(identity)
        parser.feed(html)
        if (parser.sections != 1 or len(parser.headings) != 1 or not parser.canonical_links
                or any(not catch_period.same_page(ref, url) for ref in parser.canonical_links)):
            return None
        company = CompanySlotParser(identity, url)
        company.feed(html)
        if company.overflow:
            return None
        if company.names:
            return unique_name(company.names)
        # If the visible slot is absent, use only the same heading/canonical's job.
        title = lambda value: re.sub(r"^\[[^\]\n]{1,100}\]\s*", "", " ".join(value.split()))
        return unique_name(organization(item) for item in job_postings(page.json_ld_blocks)
                           if isinstance(item.get("title"), str)
                           and title(item["title"]) == title(parser.headings[0])
                           and references_match(item, url, catch_period.same_page)
                           and ("identifier" not in item or str(item["identifier"].get("value")
                                if isinstance(item["identifier"], dict) else item["identifier"]) == identity))
    source = urlsplit(url)
    if (source.hostname in {"www.saramin.co.kr", "saramin.co.kr"}
            and source.path in {"/zf_user/jobs/view", "/zf_user/jobs/relay/view"}):
        try:
            ids = parse_qs(source.query, max_num_fields=100).get("rec_idx", [])
        except ValueError:
            return None
        if len(ids) != 1 or not re.fullmatch(r"[0-9]{1,20}", ids[0]):
            return None
        company = CompanySlotParser(ids[0], url, "saramin")
        company.feed(html)
        if company.overflow:
            return None
        if company.names:
            return unique_name(company.names)
    if jasoseol_period.job_id(url):
        parser = jasoseol_period.JasoseolParser()
        parser.feed(html)
        if (not parser.canonical_links
                or any(not jasoseol_period.same_page(ref, url) for ref in parser.canonical_links)):
            return None
        job = jasoseol_period.same_job_data(parser, url)
        return company_value(job.get("name")) if job else None
    for module, parser_type in ((linkareer_period, linkareer_period.LinkareerParser),
                                 (jobplanet_period, jobplanet_period.JobPlanetParser)):
        if not module.job_id(url):
            continue
        parser = parser_type()
        parser.feed(html)
        if (len(parser.headings) != 1 or not parser.canonical_links
                or any(not module.same_page(ref, url) for ref in parser.canonical_links)):
            return None
        return unique_name(organization(item) for item in job_postings(page.json_ld_blocks)
                           if item.get("title") == parser.headings[0]
                           and references_match(item, url, module.same_page))
    # JobKorea and Saramin expose hiringOrganization on an exact same-job record.
    # For other hosts too, do not borrow a company from unrelated JobPosting data.
    names = []
    for item in job_postings(page.json_ld_blocks):
        refs = [item[key] for key in ("url", "@id") if key in item]
        if not refs and "mainEntityOfPage" in item:
            value = item["mainEntityOfPage"]
            refs = [value.get("@id") if isinstance(value, dict) else value]
        if refs and all(isinstance(ref, str) and same_job_page(ref, url) for ref in refs):
            if (urlsplit(url).hostname in {"www.jobkorea.co.kr", "jobkorea.co.kr"}
                    and "identifier" in item):
                value = item["identifier"]
                if str(value.get("value") if isinstance(value, dict) else value) != urlsplit(url).path.rsplit("/", 1)[-1]:
                    continue
            names.append(organization(item))
    return unique_name(names)
