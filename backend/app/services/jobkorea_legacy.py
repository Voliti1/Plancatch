"""Bounded primary closing policy and legacy date, owned by the canonical job."""
import re

from app.services.extraction import PageParser, same_job_page
from app.services.jobkorea_period import is_job_url
from app.services.url_deadlines import OPEN, date_choice

MARKER = "[잡코리아 동일 공고의 접수 마감 정보]"


class LegacyFields(PageParser):
    def __init__(self):
        super().__init__()
        self.descriptions = []
        self.primary_legacy_layout = False
        self.overflow = False
        self.application_depth = self.label_depth = self.label_parent = self.value_depth = 0
        self.field_label = ""
        self.label_chunks, self.value_chunks, self.closing_fields = [], [], []

    def handle_starttag(self, tag, attrs):
        super().handle_starttag(tag, attrs)
        values = dict(attrs)
        if (tag == "meta" and any(name == "head" for name, _, _ in self.stack)
                and not any(hidden for _, hidden, _ in self.stack)
                and (values.get("name") == "description" or values.get("property") == "og:description")):
            value = values.get("content") or ""
            if len(value) <= 1000 and len(self.descriptions) < 4:
                self.descriptions.append(value)
            else:
                self.overflow = True
        if (tag == "div" and "gibReadDetailView" in (values.get("class") or "").split()
                and not any(hidden for _, hidden, _ in self.stack)):
            self.primary_legacy_layout = True
        if any(hidden for _, hidden, _ in self.stack):
            return
        depth = len(self.stack)
        if tag == "section" and values.get("id") == "application-section" and not self.application_depth:
            self.application_depth = depth
        if self.application_depth and tag == "dt":
            self.label_depth, self.label_parent, self.label_chunks = depth, depth - 1, []
        if tag == "dd" and self.field_label == "마감일" and depth - 1 == self.label_parent:
            self.value_depth, self.value_chunks, self.field_label = depth, [], ""

    def handle_data(self, data):
        super().handle_data(data)
        if any(hidden for _, hidden, _ in self.stack):
            return
        for depth, chunks in ((self.label_depth, self.label_chunks), (self.value_depth, self.value_chunks)):
            if depth:
                if sum(map(len, chunks)) + len(data) <= 300:
                    chunks.append(data)
                else:
                    self.overflow = True

    def handle_endtag(self, tag):
        target = next((i + 1 for i in range(len(self.stack) - 1, -1, -1) if self.stack[i][0] == tag), None)
        if target is not None:
            if self.label_depth >= target:
                self.field_label = " ".join("".join(self.label_chunks).split())
                self.label_depth = 0
            if self.value_depth >= target:
                if len(self.closing_fields) < 4:
                    self.closing_fields.append(" ".join("".join(self.value_chunks).split()))
                else:
                    self.overflow = True
                self.value_depth = 0
            if self.label_parent >= target:
                self.field_label = ""
            if self.application_depth >= target:
                self.application_depth = 0
        super().handle_endtag(tag)


def review(html: str, url: str | None, job_text: str = "") -> tuple[dict, str] | None:
    if not is_job_url(url or ""):
        return None
    parser = LegacyFields()
    parser.feed(html)
    if parser.overflow or any(not same_job_page(ref, url) for ref in parser.canonical_links):
        return None
    # Some current layouts omit canonical. The caller's already validated
    # same-job JobPosting is an alternative identity, never an arbitrary URL.
    metadata_urls = [line.removeprefix("공고 URL: ") for line in job_text.splitlines()
                     if line.startswith("공고 URL: ")]
    if not parser.canonical_links and metadata_urls != [url]:
        return None
    # The visible primary application field takes precedence over head metadata.
    # Never search company descriptions, related jobs, arbitrary JS or iframes.
    values = []
    for description in parser.descriptions:
        match = re.search(r"(?:^|,)\s*마감일\s*[:：]\s*([^,]{1,100})(?:,|$)", description)
        if match:
            values.append(match[1].strip())
    unique = sorted(set(parser.closing_fields or values))
    if not unique:
        return None
    open_ended = any(OPEN.search(value) for value in unique)
    if not parser.primary_legacy_layout and not open_ended:
        return None
    choices = []
    lines = [MARKER, f"공고 URL: {url}"]
    for value in unique:
        label = "공고 접수 안내 마감일" if parser.closing_fields else "공고 메타 설명 마감일"
        evidence = f"{label}: {value}"
        lines.append(evidence)
        if re.fullmatch(r"20\d{2}\.\d{2}\.\d{2}", value):
            choice = date_choice(value, evidence)
            if choice:
                choices.append(choice)
    conflict = len(unique) != 1
    if conflict:
        for choice in choices:
            choice.update(due_at=None, time_defaulted=False)
    return ({"choices": choices, "open_ended": open_ended,
             "has_conflict": conflict, "scope_confirmed": True}, "\n".join(lines))
