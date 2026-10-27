"""Read explicit closing dates locally; missing clocks use the reviewed KST day end."""
import hashlib
import re
from datetime import datetime, timedelta, timezone

SEOUL = timezone(timedelta(hours=9))
DEFAULT_TIME_NOTICE = "마감 시간이 없어 오후 11시 59분으로 설정했습니다. 필요하면 변경해 주세요."
DATE = re.compile(
    r"(?<![\d.])(?:(?P<year>\d{4})[.\-/년]\s*)?"
    r"(?P<month>\d{1,2})[.\-/월]\s*(?P<day>\d{1,2})(?:일)?"
    r"(?:\s*\((?P<weekday>[월화수목금토일])(?:요일)?\))?"
    r"(?:(?:[ T]+|(?=오전|오후))(?:(?P<ampm>오전|오후)\s*)?"
    r"(?P<hour>\d{1,2})(?::(?P<minute>\d{2})(?::(?P<second>\d{2})(?P<fraction>\.\d{1,6})?)?"
    r"|시(?:\s*(?P<kminute>\d{1,2})분)?)(?P<offset>Z|[+-]\d{2}:\d{2})?)?"
    r"(?!\d)"
)
RANGE = re.compile(r"[~～〜∼–—]")
INCOMPLETE_CLOCK = re.compile(r"^[ T]*(?:오전|오후|\d{1,2}\s*[:시])")
FOREIGN_ZONE = re.compile(r"\b(?:UTC|GMT|JST|P[SD]T|E[SD]T|C[SD]T|M[SD]T|CET|CEST)\b|"
                          r"(?:America|Europe|Pacific|Australia)/|(?:미국|일본|현지|뉴욕|런던)\s*시간", re.IGNORECASE)


def date_choice(raw: str, evidence: str) -> dict | None:
    match = DATE.search(raw)
    if match is None:
        return None
    value = match.groupdict()
    day, due_at, defaulted = None, None, False
    try:
        if value["year"]:
            parsed = datetime(int(value["year"]), int(value["month"]), int(value["day"]), tzinfo=SEOUL)
            day = parsed.date().isoformat()
            if value["weekday"] and value["weekday"] != "월화수목금토일"[parsed.weekday()]:
                raise ValueError("Conflicting weekday")
            if value["hour"] is None:
                # A malformed or unfinished clock is different from an absent clock.
                if INCOMPLETE_CLOCK.search(raw[match.end():]) or FOREIGN_ZONE.search(evidence):
                    raise ValueError("Unresolved clock or timezone")
                clock = parsed.replace(hour=23, minute=59)
                defaulted = True
            else:
                hour = int(value["hour"])
                minute = int(value["minute"] or value["kminute"] or "0")
                second = int(value["second"] or "0")
                microsecond = int((value["fraction"] or ".")[1:].ljust(6, "0"))
                if value["ampm"]:
                    if not 1 <= hour <= 12:
                        raise ValueError("Invalid 12-hour clock")
                    hour = hour % 12 + (12 if value["ampm"] == "오후" else 0)
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


def closing_choice(evidence: str, context: str | None = None) -> dict | None:
    # Only the written range's end is a deadline. Never infer a year from today's date.
    if re.search(r"채용\s*시|채용\s*완료\s*시|상시\s*모집", evidence):
        return None
    parts = RANGE.split(evidence)
    closing = parts[-1]
    matches = list(DATE.finditer(closing))
    if len(matches) != 1:
        return None
    match = matches[0]
    normalized = closing
    if not match["year"] and len(parts) == 2:
        preceding = list(DATE.finditer(parts[0]))
        if (len(preceding) == 1 and preceding[0]["year"]
                and (int(match["month"]), int(match["day"])) >=
                (int(preceding[0]["month"]), int(preceding[0]["day"]))):
            normalized = preceding[0]["year"] + "년 " + closing
    choice = date_choice(normalized, evidence)
    if choice:
        choice["raw_text"] = match.group(0).strip()[:100]
        if context and FOREIGN_ZONE.search(context) and not match["offset"]:
            choice.update(due_at=None, time_defaulted=False)
    return choice


def readable_warning(value: str) -> str:
    if re.search(r"\bdue_at\b|\bnull\b", value, re.IGNORECASE):
        return "마감 날짜와 시간을 확인해 주세요. 시간이 없으면 오후 11시 59분으로 설정됩니다."
    return value


def resolved_warnings(warnings: list[str], defaulted: bool, resolved: bool) -> list[str]:
    if resolved:
        # Retire only clock-missing notices; retain real conflicts and other missing facts.
        warnings = [value for value in warnings if not (
            re.search(r"(?:시간|시각|시,?\s*분).{0,25}(?:없|명시되|명시되어|누락)|due_at.{0,20}null", value)
            and not re.search(r"충돌|다르|연도|제목|회사|기업|날짜.{0,8}(?:없|불명확)", value))]
    warnings = [readable_warning(value) for value in warnings]
    if defaulted:
        warnings.append(DEFAULT_TIME_NOTICE)
    return list(dict.fromkeys(warnings))[:30]
