"""Visible Saramin application-period evidence; no JS, subrequests or timer arithmetic."""
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlsplit

from app.services.extraction import DEFAULT_TIMEZONE_POLICY, PageParser

MARKER = "[사람인 접수기간 및 방법: 동일 페이지 HTML]"
END_MARKER = "[사람인 접수기간 끝]"
CONFLICT = "주의: 사람인 접수기간의 날짜가 충돌하거나 올바르지 않습니다. 원문 확인이 필요합니다."
UNRESOLVED = "주의: 사람인 접수기간에 확정 가능한 마감 날짜·시간이 없습니다."
SEOUL = timezone(timedelta(hours=9))
DATE = re.compile(r"\d{4}\.\d{2}\.\d{2} (?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?")


def is_job_url(url: str) -> bool:
    try:
        parts = urlsplit(url)
        ids = parse_qs(parts.query, keep_blank_values=True, max_num_fields=100).get("rec_idx", [])
        return (parts.scheme in {"http", "https"} and parts.hostname in {"www.saramin.co.kr", "saramin.co.kr"}
                and parts.path in {"/zf_user/jobs/view", "/zf_user/jobs/relay/view"}
                and parts.port in {None, 80, 443} and parts.username is None and parts.password is None
                and len(ids) == 1 and re.fullmatch(r"[0-9]{1,20}", ids[0]) is not None
                and not any(ord(char) < 32 for char in url))
    except ValueError:
        return False


def parse_date(value: str) -> datetime | None:
    if not DATE.fullmatch(value):
        return None
    try:
        return datetime.fromisoformat(value.replace(".", "-").replace(" ", "T")).replace(tzinfo=SEOUL)
    except ValueError:
        return None


class PeriodParser(PageParser):
    """Capture only visible dt/dd pairs and timer spans inside jv_howto."""

    def __init__(self):
        super().__init__()
        self.sections = []
        self.section = None
        self.section_depth = self.period_depth = self.cell_depth = self.timer_depth = self.span_depth = 0
        self.cell = self.label = self.span = ""
        self.chunks = []
        self.timer = None
        self.overflow = False
        self.timer_overflow = False

    def handle_starttag(self, tag, attrs):
        previous = len(self.stack)
        super().handle_starttag(tag, attrs)
        if len(self.stack) == previous or any(skip for _, skip, _ in self.stack):
            return
        values, depth = dict(attrs), len(self.stack)
        classes = (values.get("class") or "").split()
        if tag == "div" and {"jv_cont", "jv_howto"}.issubset(classes) and self.section is None:
            if len(self.sections) >= 8:
                self.overflow = True
                return
            self.section, self.section_depth = {"pairs": [], "timers": []}, depth
        if self.section is None:
            return
        if tag == "dl" and "info_period" in classes and not self.period_depth:
            self.period_depth, self.label = depth, ""
        elif tag in {"dt", "dd"} and depth == self.period_depth + 1:
            self.cell_depth, self.cell, self.chunks = depth, tag, []
        if tag == "div" and "info_timer" in classes and not self.timer_depth:
            if len(self.section["timers"]) >= 16:
                self.timer_overflow = True
                return
            raw = values.get("data-remain-time") or ""
            self.timer = {"attribute": raw if re.fullmatch(r"[0-9]{1,9}", raw) else None}
            self.timer_depth = depth
        elif self.timer_depth and tag == "span" and ("day" in classes or "time" in classes):
            self.span_depth, self.span = depth, "day" if "day" in classes else "time"
            self.timer[self.span] = ""

    def handle_data(self, data):
        super().handle_data(data)
        if self.section is None or any(skip for _, skip, _ in self.stack):
            return
        if self.cell_depth and sum(map(len, self.chunks)) < 200:
            self.chunks.append(data[:200])
        if self.span_depth and len(self.timer[self.span]) < 100:
            self.timer[self.span] += data[:100]

    def handle_endtag(self, tag):
        # HTMLParser does not implicitly close malformed dt/dd. Incomplete pairs
        # are ignored instead of guessing a browser's repaired DOM.
        target = next((i + 1 for i in range(len(self.stack) - 1, -1, -1)
                       if self.stack[i][0] == tag), None)
        if target is not None:
            if self.cell_depth >= target:
                value = " ".join("".join(self.chunks).split())[:200]
                if self.cell == "dt":
                    self.label = value
                elif self.label in {"시작일", "마감일"}:
                    if len(self.section["pairs"]) < 32:
                        self.section["pairs"].append((self.label, value))
                    else:
                        self.overflow = True
                    self.label = ""
                self.cell_depth = 0
            if self.period_depth >= target:
                self.period_depth, self.label = 0, ""
            if self.span_depth >= target:
                self.span_depth = 0
            if self.timer_depth >= target:
                self.section["timers"].append(self.timer)
                self.timer_depth, self.timer = 0, None
            if self.section_depth >= target:
                self.sections.append(self.section)
                self.section, self.section_depth = None, 0
        super().handle_endtag(tag)


def period_text(html: str, url: str | None) -> str:
    if not url or not is_job_url(url):
        return ""
    parser = PeriodParser()
    parser.feed(html)
    pairs = [pair for section in parser.sections for pair in section["pairs"]]
    if not pairs:
        return ""  # Timer-only content never creates an absolute deadline.
    starts = {value for label, value in pairs if label == "시작일"}
    ends = {value for label, value in pairs if label == "마감일"}
    start = next(iter(starts)) if len(starts) == 1 else ""
    end = next(iter(ends)) if len(ends) == 1 else ""
    start_at, end_at = parse_date(start), parse_date(end)
    conflict = (parser.overflow or len(starts) > 1 or len(ends) > 1
                or bool(start and not start_at) or bool(start_at and end_at and start_at > end_at))
    lines = [MARKER, f"공고 URL: {url}"]
    if start:
        lines.append(f"시작일 원문: {start}")
    if end:
        lines.append(f"마감일 원문: {end}")
    if end_at and not conflict:
        lines.append(f"마감일 (정규화): {end_at.replace(tzinfo=None).isoformat()}")
        lines.append(DEFAULT_TIMEZONE_POLICY)
    if conflict:
        lines.append(CONFLICT)
    # Only one unambiguous visible timer is a snapshot. The custom attribute's
    # unit is not asserted and is never added to the current time.
    timers = [timer for section in parser.sections for timer in section["timers"]]
    if len(timers) == 1 and not parser.timer_overflow:
        timer = timers[0]
        day, clock = timer.get("day", "").strip(), timer.get("time", "").strip()
        if re.fullmatch(r"[0-9]{1,5}", day) and re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d", clock):
            lines.append(f"사이트 남은 기간 (추출 당시): {int(day)}일 {clock}")
        if timer["attribute"] is not None:
            lines.append(f"타이머 속성 (data-remain-time 원문): {timer['attribute']}")
    lines.append(END_MARKER)
    return "\n".join(lines)


def read_period(text: str) -> dict | None:
    """Read the immutable extraction snapshot, never fetch the source again."""
    if text.count(MARKER) != 1 or text.count(END_MARKER) != 1:
        return None
    block = text.split(MARKER, 1)[1].split(END_MARKER, 1)[0]
    if len(block) > 4000:
        return None
    lines = block.strip().splitlines()
    def value(label):
        matches = [line.removeprefix(label) for line in lines if line.startswith(label)]
        return matches[0] if len(matches) == 1 else None
    if not is_job_url(value("공고 URL: ") or ""):
        return None
    start, end = value("시작일 원문: "), value("마감일 원문: ")
    parsed = parse_date(end or "")
    iso = value("마감일 (정규화): ")
    remaining = value("사이트 남은 기간 (추출 당시): ")
    if remaining and not re.fullmatch(r"[0-9]{1,5}일 (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d", remaining):
        remaining = None
    return {"start_text": start, "end_text": end,
            "deadline_at": parsed if parsed and iso == parsed.replace(tzinfo=None).isoformat()
            and CONFLICT not in lines else None,
            "remaining_text": remaining, "has_conflict": CONFLICT in lines}
