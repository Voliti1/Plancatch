"""Linkareer application-period fields and same-page JobPosting expiry evidence."""
import re
from datetime import date, datetime, time, timedelta, timezone
from html import unescape
from urllib.parse import urljoin, urlsplit

from app.services.extraction import PageParser, job_postings

MARKER = "[링커리어 접수기간: 동일 공고 HTML]"
END_MARKER = "[링커리어 접수기간 끝]"
CONFLICT = "주의: 링커리어 공고 식별 정보나 접수기간·메타데이터의 날짜가 일치하지 않습니다. 원문 확인이 필요합니다."
UNRESOLVED = "링커리어 마감 시각을 확정하지 못했습니다. 원문 날짜를 확인하고 마감 시각을 직접 입력하세요."
METADATA_TIME = "공고 화면에는 마감 날짜만 표시되어 있습니다. 링커리어 메타데이터의 마감 시각을 후보로 사용하므로 기업 원문을 확인하고 필요하면 수정해 주세요."
SEOUL = timezone(timedelta(hours=9))


def job_id(url: str) -> str | None:
    try:
        value = urlsplit(url)
        match = re.fullmatch(r"/activity/([0-9]{1,20})", value.path)
        if (value.scheme in {"http", "https"} and value.hostname in {"linkareer.com", "www.linkareer.com"}
                and value.port in {None, 80, 443} and value.username is None and value.password is None
                and not any(ord(char) < 32 for char in url) and match):
            return match[1]
    except ValueError:
        pass
    return None


def same_page(reference: str, url: str) -> bool:
    try:
        source, target = urlsplit(url), urlsplit(urljoin(url, reference))
        return bool(reference.strip() and job_id(url) and job_id(target.geturl()) == job_id(url)
                    and (source.scheme, source.hostname, source.port or (443 if source.scheme == "https" else 80))
                    == (target.scheme, target.hostname, target.port or (443 if target.scheme == "https" else 80)))
    except ValueError:
        return False


def visible_date(value: str) -> tuple[date, time | None] | None:
    match = re.fullmatch(r"(\d{4}\.\d{2}\.\d{2})(?: ([01]\d|2[0-3]):([0-5]\d))?", value)
    try:
        if match:
            return (date.fromisoformat(match[1].replace(".", "-")),
                    time(int(match[2]), int(match[3])) if match[2] else None)
    except ValueError:
        pass
    return None


def resolve(start: str, end: str, metadata: str | None) -> tuple[datetime | None, bool, bool]:
    first, last = visible_date(start), visible_date(end)
    if (first is None or last is None or first[0] > last[0]
            or first[0] == last[0] and first[1] and last[1] and first[1] > last[1]):
        return None, True, False
    if metadata is None:
        return None, False, False
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", metadata):
            return None, date.fromisoformat(metadata) != last[0], False
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})", metadata):
            return None, True, False
        due = datetime.fromisoformat(metadata)
        local = due.astimezone(SEOUL)
        minute = local.time().replace(second=0, microsecond=0)
        conflict = (local.date() != last[0] or bool(last[1] and last[1] != minute)
                    or bool(first[0] == local.date() and first[1] and first[1] > minute))
        return due if not conflict else None, conflict, last[1] is None
    except (ValueError, OverflowError):
        return None, True, False


class LinkareerParser(PageParser):
    def __init__(self):
        super().__init__()
        self.dl_depth = self.label_depth = self.dd_depth = self.span_depth = self.heading_depth = 0
        self.label = ""
        self.chunks, self.span, self.heading, self.fields = [], [], [], []
        self.span_classes = set()
        self.periods, self.headings = [], []
        self.overflow = False

    def handle_starttag(self, tag, attrs):
        previous = len(self.stack)
        super().handle_starttag(tag, attrs)
        # The job title lives in a visible header, which PageParser excludes
        # from body text. Read only its h1 for identity, excluding navigation.
        if (tag == "h1" and not self.heading_depth
                and not any(hidden for _, _, hidden in self.stack)
                and not any(name in {"nav", "footer"} for name, _, _ in self.stack)):
            self.heading_depth, self.heading = len(self.stack), []
        if previous == len(self.stack) or any(skip for _, skip, _ in self.stack):
            return
        depth = len(self.stack)
        if tag == "dl" and any(name in {"main", "article"} for name, _, _ in self.stack):
            if self.dl_depth:
                self.overflow = True
            else:
                self.dl_depth = depth
        if tag == "dt" and depth == self.dl_depth + 1:
            self.label_depth, self.chunks = depth, []
        if tag == "dd" and depth == self.dl_depth + 1 and self.label == "접수기간":
            self.dd_depth, self.fields, self.label = depth, [], ""
        if self.dd_depth and tag == "span" and not self.span_depth:
            self.span_depth, self.span = depth, []
            self.span_classes = set((dict(attrs).get("class") or "").split())

    def handle_data(self, data):
        super().handle_data(data)
        if self.heading_depth and not any(hidden for _, _, hidden in self.stack):
            if sum(map(len, self.heading)) + len(data) <= 1000:
                self.heading.append(data)
            else:
                self.overflow = True
        if any(skip for _, skip, _ in self.stack):
            return
        for depth, chunks, limit in ((self.label_depth, self.chunks, 200), (self.span_depth, self.span, 200)):
            if depth:
                if sum(map(len, chunks)) + len(data) <= limit:
                    chunks.append(data)
                else:
                    self.overflow = True

    def handle_endtag(self, tag):
        target = next((i + 1 for i in range(len(self.stack) - 1, -1, -1) if self.stack[i][0] == tag), None)
        if target is not None:
            if self.label_depth >= target:
                self.label = " ".join("".join(self.chunks).split())
                self.label_depth = 0
            if self.span_depth >= target:
                if len(self.fields) < 8:
                    self.fields.append((self.span_classes, " ".join("".join(self.span).split())))
                else:
                    self.overflow = True
                self.span_depth = 0
            if self.dd_depth >= target:
                fields = self.fields
                if (len(fields) == 4 and "start-at" in fields[0][0] and fields[0][1] == "시작일"
                        and "end-at" in fields[2][0] and fields[2][1] == "마감일"):
                    if len(self.periods) < 8:
                        self.periods.append((fields[1][1], fields[3][1]))
                    else:
                        self.overflow = True
                else:
                    self.overflow = True
                self.dd_depth = 0
            if self.heading_depth >= target:
                if len(self.headings) < 8:
                    self.headings.append(" ".join("".join(self.heading).split()))
                else:
                    self.overflow = True
                self.heading_depth = 0
            if self.dl_depth >= target:
                self.dl_depth, self.label = 0, ""
        super().handle_endtag(tag)


def metadata_for(parser: LinkareerParser, url: str) -> tuple[str | None, bool]:
    if (len(parser.headings) != 1 or not parser.headings[0] or not parser.canonical_links
            or any(not same_page(ref, url) for ref in parser.canonical_links)):
        return None, True
    values = []
    for item in job_postings(parser.json_ld_blocks):
        if (not isinstance(item.get("title"), str)
                or " ".join(unescape(item["title"]).split()) != parser.headings[0]):
            continue
        # This site's identifier is a company registration number, not a job ID.
        refs = [item[key] for key in ("url", "@id", "mainEntityOfPage") if key in item]
        if not all(isinstance(ref.get("@id") if isinstance(ref, dict) else ref, str)
                   and same_page(ref.get("@id") if isinstance(ref, dict) else ref, url) for ref in refs):
            continue
        value = item.get("validThrough")
        if isinstance(value, str) and len(value) <= 80:
            values.append(value)
    unique = set(values)
    return (next(iter(unique)), False) if len(unique) == 1 else (None, len(unique) > 1)


def period_text(html: str, url: str | None) -> str:
    if job_id(url or "") is None:
        return ""
    parser = LinkareerParser()
    parser.feed(html)
    if not parser.periods:
        return ""
    start, end = parser.periods[0]
    metadata, scope_conflict = metadata_for(parser, url)
    due, conflict, _ = resolve(start, end, metadata)
    conflict |= scope_conflict or parser.overflow or len(parser.periods) != 1
    lines = [MARKER, f"공고 URL: {url}", f"시작일 원문: {start}", f"마감일 원문: {end}"]
    if metadata is not None:
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
    start, end = value("시작일 원문: ") or "", value("마감일 원문: ") or ""
    due, conflict, metadata_time = resolve(start, end, value("공고 메타데이터 마감일: "))
    conflict |= CONFLICT in block
    if due and value("마감일 (정규화): ") != due.isoformat():
        conflict = True
    return {"site": "linkareer", "source_url": value("공고 URL: "), "start_text": start,
            "end_text": end, "deadline_at": due if not conflict else None,
            "remaining_text": None, "has_conflict": conflict,
            "time_from_metadata": bool(due and not conflict and metadata_time)}
