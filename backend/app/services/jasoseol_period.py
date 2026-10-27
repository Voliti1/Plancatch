"""Jasoseol's same-job, offset-aware period, cross-checked against visible HTML."""
import json
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urljoin, urlsplit

from app.services.extraction import PageParser

MARKER = "[자소설닷컴 접수기간: 동일 공고 HTML]"
END_MARKER = "[자소설닷컴 접수기간 끝]"
CONFLICT = "주의: 자소설닷컴 공고 식별 정보 또는 접수기간의 시간대를 확인하지 못했습니다. 원문 확인이 필요합니다."
SEOUL = timezone(timedelta(hours=9))
MAX_DATA = 200_000


def job_id(url: str) -> str | None:
    try:
        value = urlsplit(url)
        match = re.fullmatch(r"/recruit/([0-9]{1,20})", value.path)
        if (value.scheme in {"http", "https"} and value.hostname in {"jasoseol.com", "www.jasoseol.com"}
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


def visible_time(value: str) -> datetime | None:
    match = re.fullmatch(r"(\d{4})년 (\d{1,2})월 (\d{1,2})일 ([01]\d|2[0-3]):([0-5]\d)", value)
    try:
        return datetime(*map(int, match.groups())) if match else None
    except ValueError:
        return None


def aware_time(value: str) -> datetime | None:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})", value):
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def matches_pair(shown_start: str, shown_end: str, start: str, end: str) -> bool:
    first, last = aware_time(start), aware_time(end)
    shown = (visible_time(shown_start), visible_time(shown_end))
    if first is None or last is None or last <= first or None in shown:
        return False
    # SSR can print UTC; the browser can print Seoul time. Both endpoints must
    # match one of those complete pairs. Never shift an unzoned date by nine hours.
    try:
        for zone in (SEOUL, timezone.utc):
            pair = tuple(item.astimezone(zone).replace(tzinfo=None, second=0, microsecond=0)
                         for item in (first, last))
            if pair == shown:
                return True
    except (ValueError, OverflowError):
        pass
    return False


def load_data(raw: str) -> dict | None:
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("duplicate JSON key")
            result[key] = value
        return result
    try:
        data = json.loads(raw, object_pairs_hook=unique)
        pending, visited = [(data, 0)], 0
        while pending:
            value, depth = pending.pop()
            visited += 1
            if visited > 4096 or depth > 32:
                return None
            if isinstance(value, dict):
                pending.extend((item, depth + 1) for item in value.values() if isinstance(item, (list, dict)))
            elif isinstance(value, list):
                pending.extend((item, depth + 1) for item in value if isinstance(item, (list, dict)))
        return data if isinstance(data, dict) else None
    except (ValueError, RecursionError):
        return None


class JasoseolParser(PageParser):
    def __init__(self):
        super().__init__()
        self.period_depth = self.span_depth = self.heading_depth = 0
        self.span, self.heading, self.fields = [], [], []
        self.periods, self.headings, self.data_blocks = [], [], []
        self.data_current = None
        self.data_size = self.data_count = 0
        self.overflow = False

    def handle_starttag(self, tag, attrs):
        visible_parent = not any(skip for _, skip, _ in self.stack)
        values = dict(attrs)
        if tag == "script" and values.get("id") == "__NEXT_DATA__" and visible_parent:
            self.data_count += 1
            if values.get("type") == "application/json" and not values.get("src") and self.data_count == 1:
                self.data_current = []
            else:
                self.overflow = True
        previous = len(self.stack)
        super().handle_starttag(tag, attrs)
        if previous == len(self.stack) or any(skip for _, skip, _ in self.stack):
            return
        depth = len(self.stack)
        if tag == "h1" and not self.heading_depth:
            self.heading_depth, self.heading = depth, []
        if tag == "div" and {"body5", "gap-[4px]"}.issubset((values.get("class") or "").split()) and not self.period_depth:
            self.period_depth, self.fields = depth, []
        if self.period_depth and tag == "span" and depth == self.period_depth + 1:
            self.span_depth, self.span = depth, []

    def handle_data(self, data):
        if self.data_current is not None:
            self.data_size += len(data)
            if self.data_size <= MAX_DATA:
                self.data_current.append(data)
            else:
                self.overflow = True
            return
        super().handle_data(data)
        if any(skip for _, skip, _ in self.stack):
            return
        for depth, chunks, limit in ((self.span_depth, self.span, 300), (self.heading_depth, self.heading, 1000)):
            if depth:
                if sum(map(len, chunks)) + len(data) <= limit:
                    chunks.append(data)
                else:
                    self.overflow = True

    def handle_endtag(self, tag):
        if tag == "script" and self.data_current is not None:
            self.data_blocks.append("".join(self.data_current))
            self.data_current = None
        target = next((i + 1 for i in range(len(self.stack) - 1, -1, -1) if self.stack[i][0] == tag), None)
        if target is not None:
            if self.span_depth >= target:
                if len(self.fields) < 8:
                    self.fields.append(" ".join("".join(self.span).split()))
                else:
                    self.overflow = True
                self.span_depth = 0
            if self.heading_depth >= target:
                if len(self.headings) < 8:
                    self.headings.append(" ".join("".join(self.heading).split()))
                else:
                    self.overflow = True
                self.heading_depth = 0
            if self.period_depth >= target:
                if len(self.fields) >= 3 and self.fields[1] == "~":
                    if len(self.periods) < 8:
                        self.periods.append((self.fields[0], self.fields[2]))
                    else:
                        self.overflow = True
                self.period_depth = 0
        super().handle_endtag(tag)


def same_job_data(parser: JasoseolParser, url: str) -> dict | None:
    if parser.data_count != 1 or len(parser.data_blocks) != 1 or parser.overflow:
        return None
    data = load_data(parser.data_blocks[0])
    if data is None or data.get("page") not in {"/desktop/recruit/[slug]", "/mobile/recruit/[slug]"}:
        return None
    try:
        props = data["props"]["pageProps"]
        job = props["initialEmploymentCompany"]
        if (str(data["query"]["slug"]) != job_id(url) or str(props["employmentCompanyId"]) != job_id(url)
                or str(job["id"]) != job_id(url) or len(parser.headings) != 1
                or not isinstance(job["title"], str) or len(job["title"]) > 1000
                or " ".join(job["title"].split()) != parser.headings[0]):
            return None
        return job if all(isinstance(job.get(key), str) and len(job[key]) <= 80
                          for key in ("start_time", "end_time")) else None
    except (KeyError, TypeError):
        return None


def period_text(html: str, url: str | None) -> str:
    if job_id(url or "") is None:
        return ""
    parser = JasoseolParser()
    parser.feed(html)
    if not parser.periods:
        return ""
    shown_start, shown_end = parser.periods[0]
    job = same_job_data(parser, url)
    start, end = (job["start_time"], job["end_time"]) if job else (shown_start, shown_end)
    conflict = (parser.overflow or len(parser.periods) != 1 or job is None
                or not parser.canonical_links or any(not same_page(ref, url) for ref in parser.canonical_links)
                or not matches_pair(shown_start, shown_end, start, end))
    lines = [MARKER, f"공고 URL: {url}", f"서버 HTML 시작일: {shown_start}", f"서버 HTML 마감일: {shown_end}",
             f"시작일 원문: {start}", f"마감일 원문: {end}"]
    if not conflict:
        lines.append(f"마감일 (정규화): {aware_time(end).isoformat()}")
    else:
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
    due = aware_time(end)
    conflict = (CONFLICT in block or not matches_pair(value("서버 HTML 시작일: ") or "",
                value("서버 HTML 마감일: ") or "", start, end)
                or due is None or value("마감일 (정규화): ") != due.isoformat())
    return {"site": "jasoseol", "source_url": value("공고 URL: "), "start_text": start,
            "end_text": end, "deadline_at": due if not conflict else None,
            "remaining_text": None, "has_conflict": conflict}
