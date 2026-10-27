"""Verified public Work24 job deadlines, including explicit end-of-day 24:00."""
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urljoin, urlsplit

from app.services.extraction import (
    DEFAULT_TIMEZONE_POLICY,
    PageParser,
    hidden_inline_style,
)

MARKER = "[고용24 접수 마감일: 동일 공고 HTML]"
END_MARKER = "[고용24 접수 마감일 끝]"
CONFLICT = "주의: 고용24 공고 인증번호나 접수 마감일의 날짜·요일·시각을 확인하지 못했습니다. 원문을 확인해 주세요."
UNRESOLVED = "고용24 원문에서 마감 시각을 확정하지 못했습니다. 날짜와 시각을 직접 확인해 입력하세요."
SEOUL = timezone(timedelta(hours=9))
PATH = "/wk/a/b/1500/empDetailAuthView.do"
DISPLAY = re.compile(r"(?P<day>\d{4}\.\d{2}\.\d{2})(?: \((?P<weekday>[월화수목금토일])\))?(?: (?P<hour>\d{2}):(?P<minute>\d{2}))?")
UTILITY_IDS = {"chkPwdCfrmYn", "chkPwdCfrmYnAdd", "chkPwdCfrmYnChg"}


def job_id(url: str) -> str | None:
    try:
        value = urlsplit(url)
        query = parse_qs(value.query, keep_blank_values=True, max_num_fields=100)
        ids = query.get("wantedAuthNo", [])
        if (value.scheme in {"http", "https"} and value.hostname in {"m.work24.go.kr", "www.work24.go.kr", "work24.go.kr"}
                and value.path == PATH and value.port in {None, 80, 443}
                and value.username is None and value.password is None
                and not any(ord(char) < 32 for char in url)
                and query.get("infoTypeCd") == ["VALIDATION"]
                and query.get("infoTypeGroup") == ["tb_workinfoworknet"]
                and len(ids) == 1 and re.fullmatch(r"K[0-9]{15}", ids[0])):
            return ids[0]
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


def parse_display(raw: str) -> tuple[datetime | None, bool]:
    match = DISPLAY.fullmatch(raw)
    if match is None:
        return None, not bool(re.fullmatch(r"채용\s*시\s*(?:마감|까지)|상시\s*모집", raw))
    try:
        day = datetime.fromisoformat(match["day"].replace(".", "-")).replace(tzinfo=SEOUL)
        if match["weekday"] and match["weekday"] != "월화수목금토일"[day.weekday()]:
            return None, True
        if match["hour"] is None:
            return None, False
        hour, minute = int(match["hour"]), int(match["minute"])
        if hour == 24:
            return (day + timedelta(days=1), False) if minute == 0 else (None, True)
        return day.replace(hour=hour, minute=minute), False
    except (ValueError, OverflowError):
        return None, True


class Work24Parser(PageParser):
    def __init__(self, url: str):
        super().__init__()
        self.url, self.identity = url, job_id(url)
        self.move_depth = self.footer_depth = self.utility_depth = 0
        self.box_depth = self.label_depth = self.label_parent = self.date_depth = 0
        self.th_depth = self.th_parent = self.td_depth = 0
        self.moves, self.hidden_ids, self.visible_ids, self.periods = [], [], [], []
        self.label, self.table_label = "", ""
        self.label_chunks, self.date_chunks, self.th_chunks, self.td_chunks = [], [], [], []
        self.overflow = False
        self.closed_utilities = 0

    def remember(self, items, value):
        if len(items) < 8:
            items.append(value)
        else:
            self.overflow = True

    @property
    def verified(self) -> bool:
        return bool(self.identity and not self.overflow and self.moves == [self.identity]
                    and self.hidden_ids == [self.identity] and self.visible_ids == [self.identity]
                    and len(self.periods) == 1 and self.periods[0])

    def closed_utility(self, tag, values) -> bool:
        # Work24's official .full_pop style is display:none. These three footer
        # dialogs maintain an account password; they do not gate the public job.
        # An active/unknown state, different location, or unverified job keeps
        # the ordinary password gate. Never clear password_form after detection.
        style = (values.get("style") or "").strip()
        return bool(tag == "section" and self.verified and self.footer_depth and self.utility_depth
                    and values.get("id") in UTILITY_IDS
                    and set((values.get("class") or "").split()) == {"full_pop", "large", "full_01"}
                    and values.get("aria-hidden") in {None, "true"}
                    and values.get("data-state") in {None, "closed"} and "open" not in values
                    and (not style or hidden_inline_style(style)))

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if self.closed_utility(tag, values):
            attrs = [*attrs, ("hidden", "")]
            self.closed_utilities += 1
        parent_visible = not any(hidden for _, _, hidden in self.stack)
        super().handle_starttag(tag, attrs)
        depth = len(self.stack)
        if tag == "footer" and values.get("id") == "footer":
            self.footer_depth = depth
        if tag == "form" and parent_visible:
            if values.get("id") == "moveForm":
                valid = (values.get("name") == "moveForm" and (values.get("method") or "").lower() == "post"
                         and same_page(values.get("action") or "", self.url))
                self.remember(self.moves, self.identity if valid else None)
                self.move_depth = depth
            if self.footer_depth and values.get("id") == "pwdCfrmForm000":
                self.utility_depth = depth
        if tag == "input" and self.move_depth and values.get("name") == "wantedAuthNo":
            valid = values.get("id") == "wantedAuthNo" and (values.get("type") or "").lower() == "hidden"
            self.remember(self.hidden_ids, values.get("value") if valid else None)
        if any(skip for _, skip, _ in self.stack):
            return
        if tag == "div" and "emp_colbox_div" in (values.get("class") or "").split() and not self.box_depth:
            self.box_depth = depth
        if tag == "strong" and self.box_depth:
            self.label_depth, self.label_parent, self.label_chunks = depth, depth - 1, []
        if tag == "p" and self.label == "접수 마감일" and depth - 1 == self.label_parent:
            self.date_depth, self.date_chunks, self.label = depth, [], ""
        if tag == "th" and depth > 1 and self.stack[-2][0] == "tr":
            self.th_depth, self.th_parent, self.th_chunks = depth, depth - 1, []
        if tag == "td" and self.table_label.startswith("구인인증번호") and depth - 1 == self.th_parent:
            self.td_depth, self.td_chunks, self.table_label = depth, [], ""

    def handle_data(self, data):
        super().handle_data(data)
        if any(skip for _, skip, _ in self.stack):
            return
        for depth, chunks, limit in ((self.label_depth, self.label_chunks, 200),
                                    (self.date_depth, self.date_chunks, 200),
                                    (self.th_depth, self.th_chunks, 1500), (self.td_depth, self.td_chunks, 100)):
            if depth:
                if sum(map(len, chunks)) + len(data) <= limit:
                    chunks.append(data)
                else:
                    self.overflow = True

    def handle_endtag(self, tag):
        target = next((i + 1 for i in range(len(self.stack) - 1, -1, -1) if self.stack[i][0] == tag), None)
        if target is not None:
            if self.label_depth >= target:
                self.label = " ".join("".join(self.label_chunks).split())
                self.label_depth = 0
            if self.date_depth >= target:
                self.remember(self.periods, " ".join("".join(self.date_chunks).split()))
                self.date_depth = 0
            if self.th_depth >= target:
                self.table_label = " ".join("".join(self.th_chunks).split())
                self.th_depth = 0
            if self.td_depth >= target:
                self.remember(self.visible_ids, " ".join("".join(self.td_chunks).split()))
                self.td_depth = 0
            if self.label_parent >= target:
                self.label = ""
            if self.th_parent >= target:
                self.table_label = ""
            for field in ("move_depth", "footer_depth", "utility_depth", "box_depth"):
                if getattr(self, field) >= target:
                    setattr(self, field, 0)
        super().handle_endtag(tag)


def period_text(html: str, url: str | None, parser: Work24Parser | None = None) -> str:
    if job_id(url or "") is None:
        return ""
    if parser is None:
        parser = Work24Parser(url)
        parser.feed(html)
    if not parser.periods:
        return ""
    raw = parser.periods[0]
    due, conflict = parse_display(raw)
    conflict |= not parser.verified
    lines = [MARKER, f"공고 URL: {url}", f"공고 인증번호: {job_id(url)}", f"마감일 원문: {raw}"]
    if due and not conflict:
        lines.extend([f"마감일 (정규화): {due.isoformat()}", DEFAULT_TIMEZONE_POLICY])
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
    identity = job_id(value("공고 URL: ") or "")
    raw = value("마감일 원문: ")
    if identity is None or raw is None or value("공고 인증번호: ") != identity:
        return None
    due, conflict = parse_display(raw)
    conflict |= CONFLICT in block
    if due and value("마감일 (정규화): ") != due.isoformat():
        conflict = True
    return {"site": "work24", "start_text": None, "end_text": raw,
            "deadline_at": due if not conflict else None, "remaining_text": None,
            "has_conflict": conflict}
