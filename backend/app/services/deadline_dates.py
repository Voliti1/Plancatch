"""Read explicit closing dates locally; missing clocks use the reviewed KST day end."""
import hashlib
import re
from datetime import datetime, timedelta, timezone

SEOUL = timezone(timedelta(hours=9))
DEFAULT_TIME_NOTICE = "마감 시간이 없어 오후 11시 59분으로 설정했습니다. 필요하면 변경해 주세요."
UNRESOLVED_FILE_TIME = "원문 근거에서 마감 일시를 확정하지 못했습니다. 날짜와 시간을 직접 확인해 주세요."
UNRESOLVED_FILE_CANDIDATE = "마감 날짜와 시간을 확인하지 못한 후보는 직접 입력하거나 제외해 주세요."
DOCUMENT_HEADING_YEAR = re.compile(
    r"^\s*(20\d{2})(?:\s*년(?:도)?)?(?:\s+|(?=[상하]반기)).{0,160}(?:채용|모집|공고|안내|접수|공모|일정)"
)
DATE = re.compile(
    r"(?<![\d.])(?:(?P<year>\d{4})\s*[.\-/년]\s*)?"
    r"(?P<month>\d{1,2})\s*[.\-/월]\s*(?P<day>\d{1,2})(?:\s*일|\.)?"
    r"(?:\s*[(（]\s*(?P<weekday>[월화수목금토일])(?:요일)?\s*[)）])?"
    r"(?:(?:[\sT]+|(?=오전|오후|AM|PM)|(?<=[)）일.]))(?:(?P<ampm>오전|오후|AM|PM)\s*)?"
    r"(?P<hour>\d{1,2})\s*(?:[:：]\s*(?P<minute>\d{2})(?:[:：]\s*(?P<second>\d{2})(?P<fraction>\.\d{1,6})?)?"
    r"|시(?:\s*(?P<kminute>\d{1,2})\s*분(?:\s*(?P<ksecond>\d{1,2})\s*초)?)?(?:\s*(?P<half>반))?"
    r"|(?=AM|PM))(?P<offset>Z|[+-]\d{2}:\d{2})?(?:\s*(?P<suffix>AM|PM))?)?"
    r"(?![\d:：])", re.IGNORECASE
)
PDF_DATE = re.compile(DATE.pattern.replace(r"(?P<year>\d{4})", r"(?P<year>\d{4}|['’‘]\d{2})"), DATE.flags)
RANGE = re.compile(r"[~～〜∼–—]")
INCOMPLETE_CLOCK = re.compile(r"^[ T]*(?:오전|오후|\d{1,2}\s*[:시])")
CLOCK_SIGNAL = re.compile(r"오전|오후|정오|자정|\b(?:AM|PM)\b|\d{1,2}\s*[:：시hH]", re.IGNORECASE)
FOREIGN_ZONE = re.compile(r"\b(?:UTC|GMT|JST|P[SD]T|E[SD]T|C[SD]T|M[SD]T|CET|CEST)\b|"
                          r"(?:America|Europe|Pacific|Australia)/|(?:미국|일본|현지|뉴욕|런던)\s*시간", re.IGNORECASE)


def date_choice(raw: str, evidence: str, *, date_pattern: re.Pattern[str] = DATE) -> dict | None:
    match = date_pattern.search(raw)
    if match is None:
        return None
    value = match.groupdict()
    day, due_at, defaulted = None, None, False
    try:
        if value["year"]:
            year = int(value["year"]) if value["year"].isdigit() else 2000 + int(value["year"][1:])
            parsed = datetime(year, int(value["month"]), int(value["day"]), tzinfo=SEOUL)
            day = parsed.date().isoformat()
            if value["weekday"] and value["weekday"] != "월화수목금토일"[parsed.weekday()]:
                raise ValueError("Conflicting weekday")
            if value["hour"] is None:
                # A malformed or unfinished clock is different from an absent clock.
                if (INCOMPLETE_CLOCK.search(raw[match.end():]) or CLOCK_SIGNAL.search(raw[match.end():])
                        or FOREIGN_ZONE.search(evidence)):
                    raise ValueError("Unresolved clock or timezone")
                clock = parsed.replace(hour=23, minute=59)
                defaulted = True
            else:
                if re.match(r"\s*(?:AM|PM|오전|오후)\b", raw[match.end():], re.IGNORECASE):
                    raise ValueError("Extra conflicting clock phase")
                hour = int(value["hour"])
                minute = int(value["minute"] or value["kminute"] or "0")
                if value["half"]:
                    if value["kminute"]:
                        raise ValueError("Conflicting half-hour clock")
                    minute = 30
                second = int(value["second"] or value["ksecond"] or "0")
                microsecond = int((value["fraction"] or ".")[1:].ljust(6, "0"))
                phases = {phase.upper().replace("오전", "AM").replace("오후", "PM")
                          for phase in (value["ampm"], value["suffix"]) if phase}
                if len(phases) > 1:
                    raise ValueError("Conflicting AM/PM")
                if phases:
                    if not 1 <= hour <= 12:
                        raise ValueError("Invalid 12-hour clock")
                    hour = hour % 12 + (12 if "PM" in phases else 0)
                if hour == 24 and not (minute or second or microsecond):
                    clock = parsed + timedelta(days=1)
                else:
                    clock = parsed.replace(hour=hour, minute=minute, second=second, microsecond=microsecond)
                if value["offset"]:
                    clock = datetime.fromisoformat(clock.replace(tzinfo=None).isoformat() + value["offset"])
                elif FOREIGN_ZONE.search(evidence):
                    raise ValueError("Unresolved timezone")
            due_at = clock.isoformat()
    except (ValueError, OverflowError):
        due_at, defaulted = None, False
    token, evidence = match.group(0).strip()[:100], evidence.strip()[:500]
    return {"id": hashlib.sha256((token + "\n" + evidence).encode()).hexdigest()[:16],
            "raw_text": token, "date": day, "due_at": due_at, "evidence_text": evidence,
            "time_defaulted": defaulted}


def closing_choice(evidence: str, context: str | None = None, *, document_year: str | None = None,
                   date_pattern: re.Pattern[str] = DATE) -> dict | None:
    # Only the written range's end is a deadline. Never infer a year from today's date.
    if re.search(r"채용\s*시|채용\s*완료\s*시|상시\s*모집", evidence):
        return None
    parts = RANGE.split(evidence)
    closing = parts[-1]
    matches = list(date_pattern.finditer(closing))
    if len(matches) != 1:
        return None
    match = matches[0]
    normalized = closing
    if not match["year"] and len(parts) == 1 and document_year:
        normalized = closing[:match.start()] + f"{document_year}년 " + closing[match.start():]
    elif not match["year"] and len(parts) == 2:
        preceding = list(date_pattern.finditer(parts[0]))
        if len(preceding) == 1:
            opening = preceding[0]
            year = opening["year"] or document_year
            # A year from the heading must also fit the written opening weekday.
            if year and (int(match["month"]), int(match["day"])) >= (int(opening["month"]), int(opening["day"])):
                opening_text = opening.group() if opening["year"] else f"{year}년 {opening.group()}"
                if ((opening["year"] and date_pattern is DATE)
                        or date_choice(opening_text, opening.group(), date_pattern=date_pattern)["due_at"]):
                    normalized = closing[:match.start()] + f"{year}년 " + closing[match.start():]
    choice = date_choice(normalized, evidence, date_pattern=date_pattern)
    if choice:
        choice["raw_text"] = match.group(0).strip()[:100]
        # The model may quote only the date although its transcript continues
        # immediately with a clock. Extend that exact quote, never borrow another
        # line's working hours or an unrelated notice's date/time.
        if context and context.count(evidence) == 1 and not match["hour"]:
            position = context.index(evidence) + len(evidence)
            tail = context[position:position + 100]
            extended = date_pattern.search(normalized + tail)
            if extended and extended["hour"] and extended.end() > len(normalized):
                added = extended.end() - len(normalized)
                quote = evidence + tail[:added]
                if len(quote) <= 500:
                    choice = date_choice(normalized + tail, quote, date_pattern=date_pattern)
                    choice["raw_text"] = (match.group(0).strip() + tail[:added])[:100]
            elif choice["time_defaulted"] and CLOCK_SIGNAL.match(tail.lstrip(" .\t\r\n")):
                choice.update(due_at=None, time_defaulted=False)
        if context and FOREIGN_ZONE.search(context) and not match["offset"]:
            choice.update(due_at=None, time_defaulted=False)
    return choice


def pdf_document_year(transcript: str) -> str | None:
    """Use a single explicit notice-heading year, excluding dates in the body."""
    years = {match[1] for line in transcript.splitlines()
             if (match := DOCUMENT_HEADING_YEAR.match(line)) and DATE.search(line) is None}
    return next(iter(years)) if len(years) == 1 else None


def pdf_closing_choice(evidence: str, context: str, transcript: str, heading_year: str | None) -> dict | None:
    parts = RANGE.split(evidence)
    opening = PDF_DATE.search(parts[0]) if len(parts) == 2 else None
    if opening and not opening["year"]:
        # The transcript may repeat the same range with the opening year printed.
        # Match the full quote so a different event on the same day cannot supply its year.
        range_text = evidence[opening.start():].strip()
        compact_range = re.sub(r"[^\S\n]+", "", range_text)
        dated_quote = rf"(?<![\d.])(20\d{{2}})[.\-/년]{re.escape(compact_range)}(?![\d:：]|[+-]\d|Z\b|AM\b|PM\b)"
        years = set(re.findall(dated_quote, re.sub(r"[^\S\n]+", "", transcript)))
        if heading_year:
            years.add(heading_year)
        heading_year = next(iter(years)) if len(years) == 1 else None
    return closing_choice(evidence, context, document_year=heading_year, date_pattern=PDF_DATE)


def readable_warning(value: str) -> str:
    if re.search(r"\bdue_at\b|\bnull\b", value, re.IGNORECASE):
        return "마감 날짜와 시간을 확인해 주세요. 시간이 없으면 오후 11시 59분으로 설정됩니다."
    return value


def resolved_warnings(warnings: list[str], defaulted: bool, resolved: bool) -> list[str]:
    if not defaulted:
        warnings = [value for value in warnings if value != DEFAULT_TIME_NOTICE]
    if resolved:
        # Retire only clock-missing notices; retain real conflicts and other missing facts.
        warnings = [value for value in warnings if not (
            re.search(r"(?:시간|시각|시,?\s*분).{0,25}(?:없|명시되|명시되어|누락)|due_at.{0,20}null", value)
            and not re.search(r"충돌|다르|연도|제목|회사|기업|날짜.{0,8}(?:없|불명확)", value))]
    warnings = [readable_warning(value) for value in warnings]
    if defaulted:
        warnings.append(DEFAULT_TIME_NOTICE)
    return list(dict.fromkeys(warnings))[:30]
