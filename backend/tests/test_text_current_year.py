"""Entered month/day text uses the analysis year's KST calendar, never the model's year."""
import json
import uuid
from datetime import UTC, datetime

import pytest

from app.services import ai_analysis as service
from app.services.deadline_dates import DEFAULT_TIME_NOTICE, closing_choice
from tests.test_sources import auth_headers, client, configure_test_jwt  # noqa: F401

REFERENCE = datetime(2026, 11, 26, 0, tzinfo=UTC)
MISSING_YEAR = "연도가 명시되지 않아 임의로 올해(2024년)를 적용했습니다."


def provider(monkeypatch, text, due_at, *, evidence=None, warnings=None):
    calls = []
    def respond(payload, model):
        calls.append(payload)
        return {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": json.dumps({
            "deadlines": [{"title": "회식", "due_at": due_at, "description": None,
                           "evidence_text": evidence or text, "confidence": 0.8}],
            "warnings": warnings or [],
        }, ensure_ascii=False)}]}}]}
    monkeypatch.setattr(service, "provider_request", respond)
    return calls


@pytest.mark.parametrize("model_due", [None, "2024-12-03T17:00:00+09:00", "2027-12-03T17:00:00+09:00"])
def test_requested_sentence_corrects_a_missing_or_invented_year(monkeypatch, model_due):
    text = "12월 3일 17시에 회식"
    calls = provider(monkeypatch, text, model_due, warnings=[MISSING_YEAR, "참석 장소를 확인하세요."])
    result = service.analyze_text(text, "test-model", REFERENCE)
    assert result.deadlines[0].due_at.isoformat() == "2026-12-03T17:00:00+09:00"
    assert result.deadlines[0].evidence_text == text
    assert result.warnings == ["참석 장소를 확인하세요."]
    prompt = calls[0]["systemInstruction"]["parts"][0]["text"]
    assert "2026-11-26T09:00:00+09:00" in prompt and "use 2026" in prompt
    assert "Include dated meetings and events" in prompt
    assert calls[0]["contents"][0]["parts"][0]["text"] == text


@pytest.mark.parametrize("reference,expected", [
    (datetime(2026, 12, 31, 14, 59, tzinfo=UTC), "2026-12-03T17:00:00+09:00"),
    (datetime(2026, 12, 31, 15, 0, tzinfo=UTC), "2027-12-03T17:00:00+09:00"),
    (datetime(2029, 1, 1, 0, 0), "2029-12-03T17:00:00+09:00"),
])
def test_reference_year_uses_seoul_even_when_the_server_is_still_in_december(monkeypatch, reference, expected):
    text = "12월 3일 17시에 회식"
    provider(monkeypatch, text, "2024-12-03T17:00:00+09:00")
    assert service.analyze_text(text, "test-model", reference).deadlines[0].due_at.isoformat() == expected


@pytest.mark.parametrize("text,model_due,expected", [
    ("1월 2일 오후 3시 회의", "2027-01-02T15:00:00+09:00", "2026-01-02T15:00:00+09:00"),
    ("2027년 12월 3일 17시 회식", "2027-12-03T17:00:00+09:00", "2027-12-03T17:00:00+09:00"),
    ("2024년 12월 3일 17시 회식", "2024-12-03T17:00:00+09:00", "2024-12-03T17:00:00+09:00"),
    ("내년 12월 3일 17시 회식", "2027-12-03T17:00:00+09:00", "2027-12-03T17:00:00+09:00"),
    ("작년 12월 3일 17시 회식", "2025-12-03T17:00:00+09:00", "2025-12-03T17:00:00+09:00"),
    ("12월 3일 17:30 회식", None, "2026-12-03T17:30:00+09:00"),
    ("12월 3일 오후 5시 반 회식", None, "2026-12-03T17:30:00+09:00"),
])
def test_written_years_and_clock_details_are_preserved_without_next_year_rollover(monkeypatch, text, model_due, expected):
    provider(monkeypatch, text, model_due)
    assert service.analyze_text(text, "test-model", REFERENCE).deadlines[0].due_at.isoformat() == expected


def test_a_date_only_quote_uses_the_clock_immediately_after_it(monkeypatch):
    text = "12월 3일 17시에 회식"
    provider(monkeypatch, text, "2024-12-03T23:59:00+09:00", evidence="12월 3일")
    result = service.analyze_text(text, "test-model", REFERENCE)
    assert result.deadlines[0].due_at.isoformat() == "2026-12-03T17:00:00+09:00"
    assert DEFAULT_TIME_NOTICE not in result.warnings


def test_missing_clock_keeps_the_existing_reviewed_end_of_day_default(monkeypatch):
    text = "12월 3일까지 보고서 제출"
    provider(monkeypatch, text, None, warnings=[MISSING_YEAR])
    result = service.analyze_text(text, "test-model", REFERENCE)
    assert result.deadlines[0].due_at.isoformat() == "2026-12-03T23:59:00+09:00"
    assert result.warnings == [DEFAULT_TIME_NOTICE]


@pytest.mark.parametrize("text", ["2월 29일 17시 회식", "2월 30일 17시 회식", "12월 3일(화) 17시 회식",
                                  "12월 3일 25:00 회식", "12월 31일 ~ 1월 2일 접수",
                                  "12월 3일 또는 12월 4일 회식"])
def test_invalid_dates_clocks_weekdays_and_year_crossing_ranges_are_not_repaired(monkeypatch, text):
    provider(monkeypatch, text, "2024-02-29T17:00:00+09:00", warnings=[MISSING_YEAR])
    result = service.analyze_text(text, "test-model", REFERENCE)
    assert result.deadlines[0].due_at is None
    assert result.warnings  # An unresolved candidate must not lose its warnings.


def test_leap_day_is_allowed_in_an_actual_leap_year(monkeypatch):
    text = "2월 29일 17시 회식"
    provider(monkeypatch, text, None)
    result = service.analyze_text(text, "test-model", datetime(2028, 1, 1, tzinfo=UTC))
    assert result.deadlines[0].due_at.isoformat() == "2028-02-29T17:00:00+09:00"


def test_document_analysis_and_shared_date_parser_keep_their_missing_year_rule(monkeypatch):
    text = "12월 3일 17시 마감"
    calls = provider(monkeypatch, text, None, warnings=[MISSING_YEAR])
    result = service.analyze_text(text, "test-model")
    assert result.deadlines[0].due_at is None and result.warnings == [MISSING_YEAR]
    assert closing_choice(text)["due_at"] is None
    assert "Never invent a year or date" in calls[0]["systemInstruction"]["parts"][0]["text"]


def test_real_conflict_warnings_are_not_hidden_by_the_year_default(monkeypatch):
    text = "12월 3일 17시 회식"
    warning = "원문에 연도가 없으며 서로 다른 날짜가 충돌합니다. 직접 확인하세요."
    provider(monkeypatch, text, None, warnings=[warning])
    result = service.analyze_text(text, "test-model", REFERENCE)
    assert result.deadlines[0].due_at is not None and result.warnings == [warning]


def test_text_source_extract_analyze_approve_and_reload_persists_this_year_without_duplicates(monkeypatch):
    text = "12월 3일 17시에 회식"
    calls = provider(monkeypatch, text, "2024-12-03T17:00:00+09:00", warnings=[MISSING_YEAR])
    monkeypatch.setattr(service, "configured_model", lambda: "test-model")
    monkeypatch.setattr("app.api.routes.analyses.configured_model", lambda: "test-model")
    headers = auth_headers(f"year-policy-{uuid.uuid4().hex}@example.com")
    source = client.post("/api/sources", headers=headers,
                         json={"source_type": "text", "original_text": text})
    assert source.status_code == 201
    source_id = source.json()["id"]
    assert client.post(f"/api/sources/{source_id}/analyze", headers=headers).status_code == 202
    start_path = f"/api/sources/{source_id}/ai-analyses"
    assert client.post(start_path, headers=headers, json={"allow_external_ai": False}).status_code == 422
    assert not calls
    started = client.post(start_path, headers=headers, json={"allow_external_ai": True})
    assert started.status_code == 202
    path = f"/api/ai-analyses/{started.json()['id']}"
    result = client.get(path, headers=headers).json()
    assert result["status"] == "ready" and result["warnings"] == []
    year = datetime.fromisoformat(result["created_at"])
    expected = f"{service.seoul_reference(year).year}-12-03T17:00:00+09:00"
    assert result["candidates"][0]["due_at"] == expected
    assert result["candidates"][0]["selected"] is True
    assert client.get("/api/deadlines", headers=headers).json() == []
    approved = client.post(path + "/approve", headers=headers, json={"revision": result["revision"]})
    assert approved.status_code == 200
    assert client.post(path + "/approve", headers=headers,
                       json={"revision": result["revision"]}).json()["approved_deadline_ids"] == approved.json()["approved_deadline_ids"]
    saved = client.get("/api/deadlines", headers=headers).json()
    assert len(saved) == 1
    assert datetime.fromisoformat(saved[0]["due_at"]) == datetime.fromisoformat(expected)
    assert client.get(path, headers=headers).json()["candidates"][0]["due_at"] == expected
