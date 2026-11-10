"""Seoul-local recurrence expansion; never materializes occurrences in the DB."""
from calendar import monthrange
from datetime import UTC, datetime, time, timedelta, timezone

from app.schemas.recurrence import Recurrence

SEOUL = timezone(timedelta(hours=9))


def utc(value):
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def validate(rule, schedule_type, start, end):
    if not rule:
        return
    rule = Recurrence.model_validate(rule)
    if schedule_type != "fixed" or not start or not end or utc(end) <= utc(start):
        raise ValueError("반복 일정은 시작·종료 시간이 있는 고정 할 일로 등록해 주세요.")
    try:
        utc(start).astimezone(SEOUL)
        utc(end).astimezone(SEOUL)
    except OverflowError:
        raise ValueError("한국 시간으로 표시할 수 있는 날짜를 선택해 주세요.") from None
    if rule.until and rule.until < utc(start).astimezone(SEOUL).date():
        raise ValueError("반복 종료일은 첫 일정 날짜 이후로 설정해 주세요.")


def google_rule(rule):
    if not rule:
        return []
    value = Recurrence.model_validate(rule)
    parts = ["FREQ=" + value.frequency.upper(), "INTERVAL=" + str(value.interval)]
    if value.count is not None:
        parts.append("COUNT=" + str(value.count))
    if value.until is not None:
        last = datetime.combine(value.until, time(23, 59, 59), SEOUL).astimezone(UTC)
        parts.append("UNTIL=" + last.strftime("%Y%m%dT%H%M%SZ"))
    return ["RRULE:" + ";".join(parts)]


def same_google_rule(first, second):
    """Allow provider ordering/default normalization, never extra exception dates."""
    def normalized(lines):
        if not lines:
            return {}
        if not isinstance(lines, list) or len(lines) != 1 or not isinstance(lines[0], str):
            raise ValueError
        prefix, content = lines[0].upper().split(":", 1)
        if prefix != "RRULE":
            raise ValueError
        values = {}
        for part in content.split(";"):
            key, value = part.split("=", 1)
            if key in values or key not in {"FREQ", "INTERVAL", "COUNT", "UNTIL", "WKST"}:
                raise ValueError
            values[key] = value
        if values.get("INTERVAL") == "1":
            del values["INTERVAL"]
        if values.get("WKST") == "MO":
            del values["WKST"]
        return values
    try:
        return normalized(first) == normalized(second)
    except (TypeError, ValueError):
        return False


def occurrences(start, end, rule, first, last, limit=1001):
    """Half-open overlap range; monthly 29/30/31 skips nonexistent dates."""
    start, end, first, last = map(utc, (start, end, first, last))
    if not rule:
        return [(start, end)] if start < last and end > first else []
    value = Recurrence.model_validate(rule)
    anchor = start.astimezone(SEOUL)
    duration = end - start
    step = value.interval * (7 if value.frequency == "weekly" else 1)
    monthly = value.frequency == "monthly"
    earliest = max(start, first - min(duration, first - datetime.min.replace(tzinfo=UTC)))
    if monthly:
        local = earliest.astimezone(SEOUL)
        gap = (local.year - anchor.year) * 12 + local.month - anchor.month
        index = 0 if value.count else max(0, gap // value.interval - 1)
    else:
        index = max(0, (earliest - start).days // step)
    seen = 0 if monthly else index
    result = []
    while len(result) < limit:
        if value.count is not None and seen >= value.count:
            break
        try:
            if monthly:
                month = (anchor.year - 1) * 12 + anchor.month - 1 + index * value.interval
                year, month = month // 12 + 1, month % 12 + 1
                if year > 9999:
                    break
                if anchor.day > monthrange(year, month)[1]:
                    index += 1
                    continue
                at = anchor.replace(year=year, month=month).astimezone(UTC)
            else:
                at = start + timedelta(days=index * step)
            finish = at + duration
        except (ValueError, OverflowError):
            break
        if at >= last or (value.until and at.astimezone(SEOUL).date() > value.until):
            break
        seen += 1
        if finish > first:
            result.append((at, finish))
        index += 1
    return result
