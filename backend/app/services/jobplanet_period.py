"""JobPlanet's visible closing-date field. Date-only means user-supplied time."""
import re
from datetime import date, datetime, timedelta, timezone
from urllib.parse import parse_qs, urljoin, urlsplit

from app.services.extraction import PageParser

MARKER = "[잡플래닛 접수기간: 동일 공고 HTML]"
END_MARKER = "[잡플래닛 접수기간 끝]"
CONFLICT = "주의: 잡플래닛 공고 식별 정보나 마감 날짜·요일 표시가 일치하지 않습니다. 원문 확인이 필요합니다."
UNRESOLVED = "잡플래닛 원문에는 마감 날짜만 있고 마감 시각이 없습니다. 날짜를 확인하고 마감 시각을 직접 입력하세요."
SEOUL = timezone(timedelta(hours=9))
DISPLAY = re.compile(
    r"(?P<day>\d{4}\.\d{2}\.\d{2})(?:\s+(?P<clock>(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?))?"
    r"(?:\s*~\s*(?P<month>\d{1,2})/(?P<dom>\d{1,2})\((?P<weekday>[월화수목금토일])\))?"
)


def job_id(url: str) -> str | None:
    try:
        value = urlsplit(url)
        query = parse_qs(value.query, keep_blank_values=True, max_num_fields=100)
        ids = query.get("posting_ids[]", [])
        if (value.scheme in {"http", "https"} and value.hostname in {"www.jobplanet.co.kr", "jobplanet.co.kr"}
                and value.path == "/job/search" and value.port in {None, 80, 443}
                and value.username is None and value.password is None
                and not any(ord(char) < 32 for char in url)
                and len(ids) == 1 and re.fullmatch(r"[0-9]{1,20}", ids[0])
                and not {"posting_ids", "posting_id"}.intersection(query)):
            return ids[0]
    except ValueError:
        pass
    return None


def same_page(reference: str, url: str) -> bool:
    try:
        target, source = urlsplit(urljoin(url, reference)), urlsplit(url)
        return bool(reference.strip() and job_id(url) and job_id(target.geturl()) == job_id(url)
                    and (target.scheme, target.hostname, target.port or (443 if target.scheme == "https" else 80))
                    == (source.scheme, source.hostname, source.port or (443 if source.scheme == "https" else 80)))
    except ValueError:
        return False


def parse_display(raw: str) -> tuple[str | None, datetime | None, bool]:
    match = DISPLAY.fullmatch(raw)
    if match is None:
        return None, None, not bool(re.fullmatch(r"채용\s*시\s*마감|상시\s*(?:모집|채용)", raw))
    try:
        day = date.fromisoformat(match["day"].replace(".", "-"))
        conflict = bool(match["month"] and (
            (int(match["month"]), int(match["dom"])) != (day.month, day.day)
            or match["weekday"] != "월화수목금토일"[day.weekday()]))
        # No midnight/end-of-day default. Only a clock visibly printed in this
        # exact field can make an absolute deadline; search-cache dates cannot.
        due = (datetime.fromisoformat(day.isoformat() + "T" + match["clock"]).replace(tzinfo=SEOUL)
               if match["clock"] else None)
        return day.isoformat(), due if not conflict else None, conflict
    except ValueError:
        return None, None, True


class JobPlanetParser(PageParser):
    def __init__(self):
        super().__init__()
        self.dl_depth = self.cell_depth = self.heading_depth = self.label_parent = 0
        self.cell = self.label = ""
        self.chunks = []
        self.heading = []
        self.ends = []
        self.headings = []
        self.overflow = False

    def handle_starttag(self, tag, attrs):
        previous = len(self.stack)
        super().handle_starttag(tag, attrs)
        if (previous == len(self.stack) or any(skip for _, skip, _ in self.stack)
                or not any(name in {"main", "article"} for name, _, _ in self.stack)):
            return
        depth = len(self.stack)
        if tag == "h1" and not self.heading_depth:
            self.heading_depth, self.heading = depth, []
        if tag == "dl":
            if self.dl_depth:
                self.overflow = True
            else:
                self.dl_depth = depth
        if self.dl_depth and not self.cell_depth:
            if tag == "dt":
                self.cell_depth, self.cell, self.chunks = depth, "dt", []
                self.label_parent, self.label = depth - 1, ""
            elif tag == "dd" and self.label == "마감일" and self.label_parent == depth - 1:
                self.cell_depth, self.cell, self.chunks = depth, "dd", []
                self.label = ""

    def handle_data(self, data):
        super().handle_data(data)
        if any(skip for _, skip, _ in self.stack):
            return
        for depth, chunks, limit in ((self.cell_depth, self.chunks, 300), (self.heading_depth, self.heading, 1000)):
            if depth:
                if sum(map(len, chunks)) + len(data) <= limit:
                    chunks.append(data)
                else:
                    self.overflow = True

    def handle_endtag(self, tag):
        target = next((i + 1 for i in range(len(self.stack) - 1, -1, -1) if self.stack[i][0] == tag), None)
        if target is not None:
            if self.cell_depth >= target:
                value = " ".join(" ".join(self.chunks).split())
                if self.cell == "dt":
                    self.label = value
                elif len(self.ends) < 8:
                    self.ends.append(value)
                else:
                    self.overflow = True
                self.cell_depth = 0
            if self.heading_depth >= target:
                if len(self.headings) < 8:
                    self.headings.append(" ".join("".join(self.heading).split()))
                else:
                    self.overflow = True
                self.heading_depth = 0
            if self.label_parent >= target:
                self.label = ""
            if self.dl_depth >= target:
                self.dl_depth, self.label = 0, ""
        super().handle_endtag(tag)


def period_text(html: str, url: str | None) -> str:
    if job_id(url or "") is None:
        return ""
    parser = JobPlanetParser()
    parser.feed(html)
    if not parser.ends:
        return ""
    raw = parser.ends[0]
    day, due, conflict = parse_display(raw)
    conflict |= (parser.overflow or len(parser.ends) != 1 or len(parser.headings) != 1
                 or not parser.headings[0] or not parser.canonical_links
                 or any(not same_page(ref, url) for ref in parser.canonical_links))
    lines = [MARKER, f"공고 URL: {url}", f"마감일 원문: {raw}"]
    if day and not conflict:
        lines.append(f"확인된 마감 날짜: {day}")
    if due and not conflict:
        lines.append(f"마감일 (정규화): {due.isoformat()}")
    if conflict:
        lines.append(CONFLICT)
    lines.append(END_MARKER)
    return "\n".join(lines)


def read_period(text: str) -> dict | None:
    if text.count(MARKER) != 1 or text.count(END_MARKER) != 1:
        return None
    block = text.split(MARKER, 1)[1].split(END_MARKER, 1)[0]
    if len(block) > 4000:
        return None
    def value(label):
        found = [line.removeprefix(label) for line in block.splitlines() if line.startswith(label)]
        return found[0] if len(found) == 1 else None
    raw = value("마감일 원문: ")
    if job_id(value("공고 URL: ") or "") is None or raw is None:
        return None
    day, due, conflict = parse_display(raw)
    conflict |= CONFLICT in block or bool(day and value("확인된 마감 날짜: ") != day)
    if due and value("마감일 (정규화): ") != due.isoformat():
        conflict = True
    return {"site": "jobplanet", "source_url": value("공고 URL: "), "date": day,
            "start_text": None, "end_text": raw, "deadline_at": due if not conflict else None,
            "remaining_text": None, "has_conflict": conflict}
