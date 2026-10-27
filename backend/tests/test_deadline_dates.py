"""Korean closing clocks and date-only review defaults; no external image transmission."""
from datetime import datetime

import pytest

from app.services.deadline_dates import DEFAULT_TIME_NOTICE, closing_choice, date_choice


@pytest.mark.parametrize("raw,expected,defaulted", [
    ("2026년 10월 27일(화) 오후 5시(한국시간)까지 제출하셔야 합니다.", "2026-10-27T17:00:00+09:00", False),
    ("2026년 10월 15일(목) ~ 10월 27일(화) 오후 5시", "2026-10-27T17:00:00+09:00", False),
    ("2026년 10월 15일(목) ～ 10월 27일(화)오후 5시 30분", "2026-10-27T17:30:00+09:00", False),
    ("접수기간 2026년 10월 21일(수) ~ 11월 01일(일) 까지", "2026-11-01T23:59:00+09:00", True),
    ("2026.10.27", "2026-10-27T23:59:00+09:00", True),
    ("2026.10.27 오전 12시", "2026-10-27T00:00:00+09:00", False),
    ("2026.10.27 오후 12시", "2026-10-27T12:00:00+09:00", False),
    ("2026.10.27 24:00", "2026-10-28T00:00:00+09:00", False),
    ("2026-10-27T17:00:22.123Z", "2026-10-27T17:00:22.123000+00:00", False),
])
def test_clear_clocks_and_date_only_policy(raw, expected, defaulted):
    choice = closing_choice(raw)
    assert choice["due_at"] == expected
    assert choice["time_defaulted"] is defaulted


@pytest.mark.parametrize("raw", [
    "2026.02.30", "2026.10.27(월)", "2026.10.27 24:01", "2026.10.27 오후 13시",
    "2026.10.27 오후", "10.27 오후 5시", "2026.10.27 오후 5시 현지시간",
    "2026.12.21 ~ 1.1", "2026.10.27 25:00", "9999.12.31 24:00",
])
def test_missing_year_invalid_date_and_invalid_clocks_never_default(raw):
    assert closing_choice(raw)["due_at"] is None


def test_choices_do_not_select_between_conflicts_or_open_ended_dates():
    assert closing_choice("2026.10.27 또는 2026.10.28") is None
    assert closing_choice("채용 시 마감, 안내일 2026.10.27") is None
    assert datetime.fromisoformat(date_choice("2026.10.27", "마감일 2026.10.27")["due_at"]).hour == 23
    assert "due_at" not in DEFAULT_TIME_NOTICE and "null" not in DEFAULT_TIME_NOTICE
