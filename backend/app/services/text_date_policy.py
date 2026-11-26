"""Current-year defaults apply only to directly entered text, not captured documents."""
import re
from datetime import UTC, datetime

from app.schemas.analysis import ProviderResult
from app.services.deadline_dates import DATE, FOREIGN_ZONE, SEOUL, closing_choice

WRITTEN_YEAR = re.compile(r"(?<!\d)\d{4}\s*(?:년|[./-]\s*\d{1,2})|내년|내후년|작년|재작년")


def seoul_reference(value: datetime) -> datetime:
    # SQLAlchemy's SQLite test adapter returns UTC timestamps without tzinfo.
    return (value if value.tzinfo else value.replace(tzinfo=UTC)).astimezone(SEOUL)


def apply_current_year(result: ProviderResult, text: str, reference: datetime) -> bool:
    """Correct grounded month/day evidence even if the model supplied an old year.

    An explicitly written year anywhere in the source stays authoritative. The
    shared document parser remains strict; this opt-in policy never rolls a past
    month/day into next year or repairs an impossible calendar date.
    """
    if WRITTEN_YEAR.search(text):
        return False
    year = seoul_reference(reference).year
    resolved_count = 0
    defaulted_time = False
    for item in result.deadlines:
        matches = list(DATE.finditer(item.evidence_text))
        if not matches or any(match["year"] for match in matches):
            continue
        position = text.find(item.evidence_text)
        context = text[max(0, position - 100):position + len(item.evidence_text) + 100]
        if FOREIGN_ZONE.search(context):
            continue  # Preserve a separately stated zone interpreted by the model.
        choice = closing_choice(item.evidence_text, context, document_year=str(year))
        if choice is None:
            item.due_at = None  # Multiple alternatives or an open-ended date still need review.
            continue
        item.due_at = datetime.fromisoformat(choice["due_at"]) if choice["due_at"] else None
        resolved_count += int(item.due_at is not None)
        defaulted_time |= bool(item.due_at and choice["time_defaulted"])
    if result.deadlines and resolved_count == len(result.deadlines):
        # Retire only a resolved missing-year explanation, never date conflicts,
        # missing titles, timezone uncertainty or other unrelated warnings.
        result.warnings = [warning for warning in result.warnings if not (
            "연도" in warning
            and re.search(r"없|누락|생략|명시.{0,8}(?:않|아니)", warning)
            and re.search(r"올해|현재|가정|추정|적용|임의|확인", warning)
            and not re.search(r"충돌|다르|모순|불명확|잘못|시간대|날짜", warning)
        )]
    return defaulted_time
