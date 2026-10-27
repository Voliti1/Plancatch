"""Bounded HTML date choices. URL review never calls a generative provider."""
import hashlib
import json
import re
from datetime import datetime, timedelta, timezone

BEGIN = "[URL 마감일 HTML 검토 데이터]"
END = "[URL 마감일 HTML 검토 끝]"
URL_MODEL = "html:url:v1"
SEOUL = timezone(timedelta(hours=9))
OPEN = re.compile(r"채용\s*시|채용\s*완료\s*시|상시\s*모집")
LABEL = re.compile(r"마감일|접수\s*(?:마감|종료|기간)|지원\s*마감|모집\s*기간")
DATE = re.compile(
    r"(?<![\d.])(?:(?P<year>\d{4})[.\-/년]\s*)?"
    r"(?P<month>\d{1,2})[.\-/월]\s*(?P<day>\d{1,2})(?:일)?"
    r"(?:\s*\([월화수목금토일](?:요일)?\))?"
    r"(?:[ T]+(?P<hour>\d{1,2})(?::(?P<minute>\d{2})(?::(?P<second>\d{2})(?P<fraction>\.\d{1,6})?)?"
    r"|시(?:\s*(?P<kminute>\d{1,2})분)?)(?P<offset>Z|[+-]\d{2}:\d{2})?)?"
    r"(?!\d)"
)


def date_choice(raw: str, evidence: str) -> dict | None:
    match = DATE.search(raw)
    if match is None:
        return None
    value = match.groupdict()
    day, due_at = None, None
    try:
        if value["year"]:
            parsed = datetime(int(value["year"]), int(value["month"]), int(value["day"]), tzinfo=SEOUL)
            day = parsed.date().isoformat()
            if value["hour"] is not None:
                minute = int(value["minute"] or value["kminute"] or "0")
                clock = parsed.replace(hour=int(value["hour"]), minute=minute,
                                       second=int(value["second"] or "0"),
                                       microsecond=int((value["fraction"] or ".")[1:].ljust(6, "0")))
                if value["offset"]:
                    clock = datetime.fromisoformat(clock.replace(tzinfo=None).isoformat() + value["offset"])
                else:
                    clock = clock.replace(tzinfo=SEOUL)
                due_at = clock.isoformat()
    except ValueError:
        # Preserve the read value for manual correction; never register an invalid date.
        due_at = None
    raw, evidence = match.group(0).strip()[:100], evidence.strip()[:500]
    return {"id": hashlib.sha256((raw + "\n" + evidence).encode()).hexdigest()[:16],
            "raw_text": raw, "date": day, "due_at": due_at, "evidence_text": evidence}


def unique_choices(values: list[dict]) -> list[dict]:
    unique = {}
    for value in values:
        unique.setdefault((value["raw_text"], value["due_at"]), value)
    return list(unique.values())[:30]


def collect_review(text: str, job_text: str, period_parser=None, scoped: bool = True) -> dict:
    """Only explicit closing-period fields, matching JobPosting, or scoped main text."""
    values, open_ended = [], False
    if period_parser is not None and period_parser.sections:
        # Only the first visible period belongs to the primary notice. Never
        # combine later infinite-scroll/recommended notices into date choices.
        for section in period_parser.sections[:1]:
            for label, raw in section["pairs"]:
                if label == "마감일":
                    open_ended |= bool(OPEN.search(raw))
                    for match in DATE.finditer(raw):
                        item = date_choice(match.group(0), f"마감일 원문: {raw}")
                        if item:
                            values.append(item)
    elif job_text:
        for line in job_text.splitlines():
            if line.startswith("마감일 (validThrough):"):
                item = date_choice(line, line)
                if item:
                    values.append(item)
    elif scoped:
        lines = text.splitlines()
        for index, line in enumerate(lines):
            if not LABEL.search(line):
                continue
            context = "\n".join(lines[index:index + 3])[:500]
            open_ended |= bool(OPEN.search(context))
            # A range's opening date is not its closing date.
            closing = context.rsplit("~", 1)[-1] if "~" in context else context
            if "시작일" in closing or OPEN.search(closing):
                continue
            for match in DATE.finditer(closing):
                item = date_choice(match.group(0), context)
                if item:
                    values.append(item)
    if not (period_parser and period_parser.sections):
        # Explicit open-ended wording in the primary notice overrides a metadata
        # expiry/placeholder date. Related-job text was already excluded.
        lines = text.splitlines()
        open_ended |= any(LABEL.search(line) and OPEN.search("\n".join(lines[i:i + 3]))
                          for i, line in enumerate(lines))
    return {"choices": unique_choices(values), "open_ended": open_ended,
            "has_conflict": bool(period_parser and
                                 (period_parser.overflow or len(period_parser.sections) > 1)),
            "scope_confirmed": scoped or period_parser is not None or bool(job_text)}


def append_snapshot(text: str, submitted_url: str, fetched_url: str, review: dict) -> str:
    snapshot = {"version": 1, "submitted_url": submitted_url, "fetched_url": fetched_url, **review}
    return text + "\n\n" + BEGIN + "\n" + json.dumps(snapshot, ensure_ascii=False) + "\n" + END


def review_data(text: str, source_url: str | None = None) -> dict | None:
    if text.count(BEGIN) == text.count(END) == 1 and text.rstrip().endswith(END):
        block = text.split(BEGIN, 1)[1].rsplit(END, 1)[0].strip()
        if len(block) > 25000:
            return None
        try:
            data = json.loads(block)
            if (not isinstance(data, dict) or data.get("version") != 1
                    or not isinstance(data.get("submitted_url"), str)
                    or (source_url is not None and data["submitted_url"] != source_url)
                    or not isinstance(data.get("choices"), list) or len(data["choices"]) > 30
                    or not isinstance(data.get("open_ended"), bool)):
                return None
            from app.schemas.analysis import DateChoice
            data["choices"] = [DateChoice.model_validate(item).model_dump(mode="json")
                               for item in data["choices"]]
            return data
        except (ValueError, TypeError):
            return None
    # Previously saved Saramin snapshots remain reviewable without Gemini.
    from app.services.html_analysis import matching_period
    from app.services.saramin_period import END_MARKER, MARKER, read_period
    period = read_period(text)
    if period is None or (source_url is not None and matching_period(text, source_url) is None):
        # Historical JobPosting extracts are still usable; only their exact
        # same-page metadata is considered, never arbitrary dates in old body text.
        from app.services.extraction import same_job_page
        marker = "[동일 페이지의 채용공고 구조화 데이터: JSON-LD JobPosting]"
        if text.count(marker) != 1:
            return None
        block = text.split(marker, 1)[1]
        urls = [line.removeprefix("공고 URL: ") for line in block.splitlines()
                if line.startswith("공고 URL: ")]
        if len(urls) != 1 or (source_url and not same_job_page(urls[0], source_url)):
            return None
        return collect_review("", block, scoped=False)
    block = text.split(MARKER, 1)[1].split(END_MARKER, 1)[0]
    values = []
    for line in block.splitlines():
        if line.startswith(("마감일 원문:", "마감일 후보 원문:")):
            for match in DATE.finditer(line):
                item = date_choice(match.group(0), line)
                if item:
                    values.append(item)
    return {"choices": unique_choices(values), "open_ended": bool(OPEN.search(text)),
            "has_conflict": period["has_conflict"], "scope_confirmed": True}


def analyze_url(text: str, source_url: str, title: str | None):
    from app.schemas.analysis import ProviderResult
    from app.services.catch_period import CONFLICT as CATCH_CONFLICT
    from app.services.catch_period import UNRESOLVED as CATCH_UNRESOLVED
    from app.services.catch_period import read_period as read_catch
    from app.services.jasoseol_period import CONFLICT as JASOSEOL_CONFLICT
    from app.services.jasoseol_period import read_period as read_jasoseol
    from app.services.jobplanet_period import CONFLICT as JOBPLANET_CONFLICT
    from app.services.jobplanet_period import UNRESOLVED as JOBPLANET_UNRESOLVED
    from app.services.jobplanet_period import read_period as read_jobplanet
    from app.services.linkareer_period import CONFLICT as LINKAREER_CONFLICT
    from app.services.linkareer_period import METADATA_TIME
    from app.services.linkareer_period import UNRESOLVED as LINKAREER_UNRESOLVED
    from app.services.linkareer_period import read_period as read_linkareer
    from app.services.saramin_period import CONFLICT, UNRESOLVED
    data = review_data(text, source_url)
    choices = data["choices"] if data else []
    warnings = []
    due_at = None
    jobplanet_period = read_jobplanet(text)
    linkareer_period = read_linkareer(text)
    if data and data.get("open_ended"):
        warnings.append("채용 시 마감 또는 상시 모집입니다. 본인이 원하는 마감 날짜와 시간을 입력한 후 등록하세요.")
    elif data and data.get("has_conflict"):
        from app.services.jobkorea_period import CONFLICT as JOBKOREA_CONFLICT
        from app.services.jobkorea_period import read_period as read_jobkorea
        if linkareer_period:
            warnings.append(LINKAREER_CONFLICT)
        elif read_jasoseol(text):
            warnings.append(JASOSEOL_CONFLICT)
        elif jobplanet_period:
            warnings.append(JOBPLANET_CONFLICT)
        else:
            warnings.append(CATCH_CONFLICT if read_catch(text) else JOBKOREA_CONFLICT if read_jobkorea(text) else CONFLICT)
    elif len(choices) > 1:
        warnings.append("마감일로 읽은 날짜가 여러 개입니다. 원문을 확인하고 마감일 하나를 선택하세요.")
    elif len(choices) == 1 and data.get("scope_confirmed"):
        due_at = choices[0]["due_at"]
        if not due_at:
            warnings.append(LINKAREER_UNRESOLVED if linkareer_period else JOBPLANET_UNRESOLVED if jobplanet_period else CATCH_UNRESOLVED if read_catch(text) else UNRESOLVED)
        elif linkareer_period and linkareer_period["time_from_metadata"]:
            warnings.append(METADATA_TIME)
    else:
        warnings.append("HTML에서 확정 마감일을 찾지 못했습니다. 원문을 확인하고 마감 날짜와 시간을 직접 입력하세요.")
    if data is None:
        warnings.append("저장된 HTML 검토 정보가 없거나 일치하지 않습니다. 원문을 다시 추출하면 날짜 선택지를 확인할 수 있습니다.")
    elif not data.get("scope_confirmed"):
        warnings.append("공고 본문 범위를 확인하지 못해 추천 공고의 날짜를 자동으로 사용하지 않습니다.")
    # Evidence remains source text, including when dates cannot be confirmed.
    evidence = (choices[0]["evidence_text"] if len(choices) == 1 else text[:2000].strip())
    if not evidence or evidence not in text:
        evidence = text[:2000].strip() or "원문 확인 필요"
    return ProviderResult(deadlines=[{
        "title": (title or "").strip() or "마감일 등록", "due_at": due_at,
        "description": None, "evidence_text": evidence, "confidence": 1.0 if due_at else 0.0,
    }], warnings=warnings)
