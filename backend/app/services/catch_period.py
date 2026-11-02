"""Visible Catch closing-period evidence, matched to same-page inert JSON-LD."""
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urljoin, urlsplit

from app.services.extraction import PageParser, job_postings

MARKER = "[캐치 접수기간: 동일 공고 HTML]"
END_MARKER = "[캐치 접수기간 끝]"
CONFLICT = "주의: 캐치 접수기간과 공고 메타데이터의 날짜·요일·시각이 충돌합니다. 원문 확인이 필요합니다."
UNRESOLVED = "주의: 캐치 접수기간의 연도 또는 마감 시각을 확정하지 못했습니다. 원문을 확인하고 직접 입력하세요."
SEOUL = timezone(timedelta(hours=9))
DISPLAY = re.compile(
    r"~\s*(?:(?P<year>\d{4})[./-]\s*)?(?P<month>\d{1,2})[./-](?P<day>\d{1,2})"
    r"(?:\s*\((?P<weekday>[월화수목금토일])(?:요일)?\))?"
    r"(?:\s*(?P<hour>\d{1,2})(?::(?P<minute>\d{2})|시(?:\s*(?P<kminute>\d{1,2})분)?))?"
)


def job_id(url: str) -> str | None:
    try:
        value = urlsplit(url)
        match = re.fullmatch(r"/NCS/RecruitInfoDetails/([0-9]{1,20})", value.path)
        if (value.scheme in {"http", "https"} and value.hostname in {"www.catch.co.kr", "catch.co.kr"}
                and value.port in {None, 80, 443} and value.username is None and value.password is None
                and not any(ord(char) < 32 for char in url) and match):
            return match[1]
    except ValueError:
        pass
    return None


def same_page(reference: str, url: str) -> bool:
    try:
        target, source = urlsplit(urljoin(url, reference)), urlsplit(url)
        return bool(reference.strip() and job_id(target.geturl()) == job_id(url)
                    and job_id(url) is not None
                    and (target.scheme, target.hostname, target.port or (443 if target.scheme == "https" else 80))
                    == (source.scheme, source.hostname, source.port or (443 if source.scheme == "https" else 80)))
    except ValueError:
        return False


def resolve(raw: str, metadata: str | None) -> tuple[datetime | None, bool]:
    """No clock arithmetic, current year, title year or weekday-based year inference."""
    display = DISPLAY.fullmatch(raw)
    if display is None or metadata is None:
        return None, False
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})?", metadata):
        return None, True
    try:
        due = datetime.fromisoformat(metadata)
        if due.tzinfo is None:
            due = due.replace(tzinfo=SEOUL)
        local = due.astimezone(SEOUL)
        field = display.groupdict()
        label_day = local.date()
        midnight_label = field["hour"] == "24"
        minute = int(field["minute"] or field["kminute"] or 0)
        if midnight_label:
            # Catch prints 24시 for the labelled day's end, while JSON-LD
            # uses either its final second or exactly the following midnight.
            if minute != 0:
                return None, True
            if (local.hour, local.minute, local.second, local.microsecond) == (0, 0, 0, 0):
                label_day -= timedelta(days=1)
            elif not ((local.hour, local.minute, local.second) == (23, 59, 59)
                      or ((local.hour, local.minute) == (23, 59)
                          and re.fullmatch(r".*T23:59(?:Z|[+-]\d{2}:\d{2})?", metadata))):
                return None, True
        conflict = ((label_day.month, label_day.day) != (int(field["month"]), int(field["day"]))
                    or bool(field["year"] and label_day.year != int(field["year"]))
                    or bool(field["weekday"] and field["weekday"] != "월화수목금토일"[label_day.weekday()]))
        if field["hour"] is None:
            return None, conflict  # A hidden clock must still be supplied by the user.
        if not midnight_label:
            conflict |= (local.hour, local.minute) != (int(field["hour"]), minute)
        return (None if conflict else due), conflict
    except (ValueError, OverflowError):
        return None, True


class CatchParser(PageParser):
    def __init__(self, identity: str):
        super().__init__()
        self.identity = identity
        self.sections = 0
        self.section_depth = self.line_depth = self.cell_depth = self.heading_depth = 0
        self.first_span = False
        self.cell = []
        self.heading = []
        self.ends = []
        self.headings = []
        self.overflow = False

    def handle_starttag(self, tag, attrs):
        previous = len(self.stack)
        super().handle_starttag(tag, attrs)
        if previous == len(self.stack) or any(skip for _, skip, _ in self.stack):
            return
        values, depth = dict(attrs), len(self.stack)
        classes = (values.get("class") or "").split()
        if tag == "div" and values.get("id") == f"view2_{self.identity}" and "recr_pop_dday" in classes:
            self.sections += 1
            if self.section_depth:
                self.overflow = True
            else:
                self.section_depth = depth
        if self.section_depth and tag == "p" and "t1" in classes and not self.line_depth:
            self.line_depth, self.first_span = depth, False
        if self.line_depth and tag == "span" and depth == self.line_depth + 1 and not self.first_span:
            # Only the date span belongs to the closing label. Catch can append
            # a promotional link/button as a sibling inside the same p.t1.
            self.cell_depth, self.cell, self.first_span = depth, [], True
        if tag == "h1" and "subj" in classes and not self.heading_depth:
            self.heading_depth, self.heading = depth, []

    def handle_data(self, data):
        super().handle_data(data)
        if any(skip for _, skip, _ in self.stack):
            return
        if self.cell_depth and any(tag in {"a", "button"} for tag, _, _ in self.stack[self.cell_depth:]):
            return  # Promotional controls can also be nested inside the date span.
        for depth, chunks, limit in ((self.cell_depth, self.cell, 200), (self.heading_depth, self.heading, 1000)):
            if depth:
                if sum(map(len, chunks)) + len(data) <= limit:
                    chunks.append(data)
                else:
                    self.overflow = True

    def handle_endtag(self, tag):
        target = next((i + 1 for i in range(len(self.stack) - 1, -1, -1) if self.stack[i][0] == tag), None)
        if target is not None:
            for depth_name, chunks, values in (("cell_depth", self.cell, self.ends),
                                               ("heading_depth", self.heading, self.headings)):
                if getattr(self, depth_name) >= target:
                    if len(values) < 8:
                        values.append(" ".join("".join(chunks).split()))
                    else:
                        self.overflow = True
                    setattr(self, depth_name, 0)
            if self.section_depth >= target:
                self.section_depth = 0
            if self.line_depth >= target:
                self.line_depth, self.first_span = 0, False
        super().handle_endtag(tag)


def metadata_for(parser: CatchParser, url: str) -> tuple[str | None, bool]:
    # Catch's JobPosting omits url/@id. Restrict this exception to an exact Catch
    # DOM job ID, matching canonical URL, unique heading and matching job title.
    if (not parser.canonical_links or len(parser.headings) != 1
            or any(not same_page(ref, url) for ref in parser.canonical_links)):
        return None, bool(parser.canonical_links and any(not same_page(ref, url) for ref in parser.canonical_links))
    def title(value):
        return re.sub(r"^\[[^\]\n]{1,100}\]\s*", "", " ".join(value.split()))
    values = []
    for item in job_postings(parser.json_ld_blocks):
        if not isinstance(item.get("title"), str) or title(item["title"]) != title(parser.headings[0]):
            continue
        refs = [item[key] for key in ("url", "@id", "mainEntityOfPage") if key in item]
        if not all(isinstance(ref.get("@id") if isinstance(ref, dict) else ref, str)
                   and same_page(ref.get("@id") if isinstance(ref, dict) else ref, url) for ref in refs):
            continue
        if "identifier" in item:
            identity = item["identifier"]
            if str(identity.get("value") if isinstance(identity, dict) else identity) != job_id(url):
                continue
        value = item.get("validThrough")
        if isinstance(value, str) and len(value) <= 80:
            values.append(value)
    unique = set(values)
    return (next(iter(unique)), False) if len(unique) == 1 else (None, len(unique) > 1)


def period_text(html: str, url: str | None) -> str:
    identity = job_id(url or "")
    if identity is None:
        return ""
    parser = CatchParser(identity)
    parser.feed(html)
    if not parser.ends:
        return ""
    raw = parser.ends[0]
    metadata, conflict = metadata_for(parser, url)
    due, mismatch = resolve(raw, metadata)
    conflict |= parser.overflow or parser.sections != 1 or len(parser.ends) != 1 or mismatch
    lines = [MARKER, f"공고 URL: {url}", f"마감일 원문: {raw}"]
    if metadata:
        lines.append(f"공고 메타데이터 마감일: {metadata}")
    if due and not conflict:
        lines.append(f"마감일 (정규화): {due.isoformat()}")
    if conflict:
        lines.append(CONFLICT)
    return "\n".join([*lines, END_MARKER])


def read_period(text: str) -> dict | None:
    if text.count(MARKER) != 1 or text.count(END_MARKER) != 1:
        return None
    block = text.split(MARKER, 1)[1].split(END_MARKER, 1)[0]
    if len(block) > 4000:
        return None
    def value(label):
        found = [line.removeprefix(label) for line in block.splitlines() if line.startswith(label)]
        return found[0] if len(found) == 1 else None
    if job_id(value("공고 URL: ") or "") is None:
        return None
    raw, metadata = value("마감일 원문: "), value("공고 메타데이터 마감일: ")
    if raw is None:
        return None
    due, conflict = resolve(raw, metadata)
    conflict |= CONFLICT in block
    if due and value("마감일 (정규화): ") != due.isoformat():
        conflict = True
    return {"site": "catch", "source_url": value("공고 URL: "), "start_text": None,
            "end_text": raw, "deadline_at": due if not conflict else None,
            "remaining_text": None, "has_conflict": conflict}
