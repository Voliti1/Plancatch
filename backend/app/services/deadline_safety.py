"""Deterministic safety deadlines; no inferred buffer or calendar side effects."""

from datetime import UTC, datetime, timedelta


def calculate_safe_due_at(
    due_at: datetime, safety_buffer_minutes: int | None,
) -> datetime | None:
    """Subtract elapsed minutes in UTC, or return None when the user opted out.

    SQLite drops offsets on ORM reads; API writes are normalized to UTC first.
    PostgreSQL retains timezone-aware timestamps.
    """
    if safety_buffer_minutes is None:
        return None
    try:
        due_at = due_at.replace(tzinfo=UTC) if due_at.tzinfo is None else due_at.astimezone(UTC)
        return due_at - timedelta(minutes=safety_buffer_minutes)
    except OverflowError as exc:
        raise ValueError("safety buffer places safe_due_at outside the supported date range") from exc
