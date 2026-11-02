"""Same-job JobKorea countdown evidence from bounded inert HTML/Flight JSON.

Never execute scripts, fetch embedded URLs, or add a relative timer to a clock.
"""
import json
import re
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from urllib.parse import urlsplit

MARKER = "[잡코리아 접수기간: 동일 공고 HTML]"
END_MARKER = "[잡코리아 접수기간 끝]"
CONFLICT = "주의: 잡코리아 타이머와 공고 메타데이터의 마감 시각이 충돌합니다. 원문 확인이 필요합니다."
SEOUL = timezone(timedelta(hours=9))
MAX_STREAM = 200_000
MAX_SCRIPTS = 128
MAX_NODES = 4096


def is_job_url(url: str) -> bool:
    try:
        value = urlsplit(url)
        return (value.scheme in {"http", "https"}
                and value.hostname in {"www.jobkorea.co.kr", "jobkorea.co.kr"}
                and re.fullmatch(r"/Recruit/GI_Read/[0-9]{1,20}", value.path) is not None
                and value.port in {None, 80, 443} and value.username is None and value.password is None
                and not any(ord(char) < 32 for char in url))
    except ValueError:
        return False


def parse_end(value: str) -> datetime | None:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})", value):
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def agrees(end: datetime, metadata: str) -> bool:
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", metadata):
            return end.astimezone(SEOUL).date().isoformat() == metadata
        other = datetime.fromisoformat(metadata)
        if other.tzinfo is None:
            other = other.replace(tzinfo=SEOUL)
        # A minute-precision metadata field does not contradict explicit seconds
        # from the countdown's own endDate. Explicit seconds must match exactly.
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})?", metadata):
            return 0 <= (end - other).total_seconds() < 60
        return end == other
    except (ValueError, TypeError):
        return False


class CountdownHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.countdowns = 0
        self.script = None
        self.stream = []
        self.size = 0
        self.blocks = 0
        self.overflow = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "span" and attrs.get("data-sentry-component") == "Countdown":
            self.countdowns += 1
        if tag == "script" and not attrs.get("src"):
            self.script = []

    def handle_data(self, value):
        if self.script is not None:
            if sum(map(len, self.script)) + len(value) > MAX_STREAM:
                self.script = None
                self.overflow = True
            else:
                self.script.append(value)

    def handle_endtag(self, tag):
        if tag != "script" or self.script is None:
            return
        raw, self.script = "".join(self.script).strip(), None
        match = re.fullmatch(r"self\.__next_f\.push\((\[.*\])\);?", raw, re.DOTALL)
        if match is None:
            return
        try:
            value = json.loads(match[1])
        except (ValueError, RecursionError):
            return
        if (not isinstance(value, list) or len(value) != 2 or value[0] != 1
                or not isinstance(value[1], str)):
            return
        self.blocks += 1
        self.size += len(value[1])
        if self.blocks > MAX_SCRIPTS or self.size > MAX_STREAM:
            self.overflow = True
            return
        self.stream.append(value[1])

    def dates(self) -> list[str]:
        values, visited = [], 0
        for line in "".join(self.stream).splitlines():
            match = re.fullmatch(r"[0-9a-f]+:([\[{].*)", line)
            if match is None:
                continue
            try:
                pending = [(json.loads(match[1]), 0)]
            except (ValueError, RecursionError):
                continue
            while pending:
                node, depth = pending.pop()
                visited += 1
                if visited > MAX_NODES or depth > 32:
                    self.overflow = True
                    return []
                if isinstance(node, list):
                    if (len(node) == 4 and node[:2] == ["$", "div"] and isinstance(node[3], dict)):
                        children = node[3].get("children")
                        if isinstance(children, list) and len(children) == 2:
                            label, timer = children
                            if (isinstance(label, list) and len(label) == 4 and label[:2] == ["$", "span"]
                                    and isinstance(label[3], dict) and label[3].get("children") == "남은기간"
                                    and isinstance(timer, list) and len(timer) == 4 and timer[0] == "$"
                                    and isinstance(timer[1], str) and timer[1].startswith("$L")
                                    and isinstance(timer[3], dict) and isinstance(timer[3].get("endDate"), str)):
                                values.append(timer[3]["endDate"])
                    pending.extend((item, depth + 1) for item in node if isinstance(item, (list, dict)))
                elif isinstance(node, dict):
                    pending.extend((item, depth + 1) for item in node.values() if isinstance(item, (list, dict)))
        return values


def period_text(html: str, source_url: str | None, job_text: str) -> str:
    if not source_url or not is_job_url(source_url) or not job_text:
        return ""
    # job_text is produced by the existing same-page JobPosting validator.
    urls = [line.removeprefix("공고 URL: ") for line in job_text.splitlines() if line.startswith("공고 URL: ")]
    metadata = [line.removeprefix("마감일 (validThrough): ") for line in job_text.splitlines() if line.startswith("마감일 (validThrough): ")]
    if urls != [source_url] or len(metadata) != 1:
        return ""
    parser = CountdownHTML()
    parser.feed(html)
    dates = parser.dates()
    if not dates or not any(parse_end(value) for value in dates):
        return ""
    raw = dates[0]
    end = parse_end(raw)
    conflict = parser.overflow or parser.countdowns != 1 or len(dates) != 1 or end is None or not agrees(end, metadata[0])
    lines = [MARKER, f"공고 URL: {source_url}", f"마감일 원문: {raw}", f"공고 메타데이터 마감일: {metadata[0]}"]
    if end is not None and not conflict:
        lines.append(f"마감일 (정규화): {end.isoformat()}")
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
    if not is_job_url(value("공고 URL: ") or ""):
        return None
    raw, metadata = value("마감일 원문: "), value("공고 메타데이터 마감일: ")
    end = parse_end(raw or "")
    conflict = CONFLICT in block or end is None or not agrees(end, metadata or "")
    if end is not None and value("마감일 (정규화): ") != end.isoformat():
        conflict = True
    return {"site": "jobkorea", "source_url": value("공고 URL: "), "start_text": None,
            "end_text": raw, "deadline_at": end if not conflict else None,
            "remaining_text": None, "has_conflict": conflict}
