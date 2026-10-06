"""AI calls are mocked only in tests; production must never invent results."""
import json
import uuid
from types import SimpleNamespace

import pytest
from pydantic import SecretStr

from app.models.source import Source
from app.schemas.analysis import ProviderResult
from app.services import ai_analysis as service
from tests.test_auth import TestingSession
from tests.test_sources import auth_headers, client, configure_test_jwt  # noqa: F401

TEXT = "접수 마감: 2026-10-05 18:00 KST. 보고서 제출."
PROPOSAL = {"title": "보고서 제출", "due_at": "2026-10-05T18:00:00+09:00",
            "description": "제출", "evidence_text": TEXT, "confidence": 0.9}
REAL_ANALYZE_TEXT = service.analyze_text


@pytest.fixture(autouse=True)
def fake_provider(monkeypatch):
    monkeypatch.setattr(service, "get_settings", lambda: SimpleNamespace(
        gemini_api_key=SecretStr("test-only-key"), gemini_model="test-model"))
    monkeypatch.setattr(service, "analyze_text", lambda *args: ProviderResult(
        deadlines=[PROPOSAL], warnings=[]))


def source_and_headers():
    headers = auth_headers(f"ai-{uuid.uuid4().hex}@example.com")
    response = client.post("/api/sources", headers=headers,
                           json={"source_type": "text", "original_text": TEXT})
    source_id = response.json()["id"]
    client.post(f"/api/sources/{source_id}/analyze", headers=headers)
    return source_id, headers


def ready_analysis():
    source_id, headers = source_and_headers()
    response = client.post(f"/api/sources/{source_id}/ai-analyses", headers=headers,
                           json={"allow_external_ai": True})
    assert response.status_code == 202
    assert response.json()["status"] == "processing"
    analysis = client.get(f"/api/ai-analyses/{response.json()['id']}", headers=headers).json()
    assert analysis["status"] == "ready"
    return analysis, source_id, headers


def edit_payload(analysis):
    return {"revision": analysis["revision"], "candidates": [{
        key: item[key] for key in ("id", "title", "due_at", "description", "selected")
    } for item in analysis["candidates"]]}


def test_review_approval_is_explicit_and_idempotent():
    analysis, source_id, headers = ready_analysis()
    assert client.get("/api/deadlines", headers=headers).json() == []
    assert client.get(f"/api/sources/{source_id}/ai-analyses", headers=headers).json()[0]["id"] == analysis["id"]
    payload = edit_payload(analysis)
    payload["candidates"][0]["title"] = "수정한 마감 제목"
    path = f"/api/ai-analyses/{analysis['id']}"
    reviewed = client.patch(path, headers=headers, json=payload)
    assert reviewed.status_code == 200
    assert reviewed.json()["revision"] == 2
    assert client.patch(path, headers=headers, json=payload).status_code == 409
    assert client.post(path + "/approve", headers=headers, json={"revision": 1}).status_code == 409
    approved = client.post(path + "/approve", headers=headers, json={"revision": 2})
    assert approved.status_code == 200
    assert approved.json()["status"] == "approved"
    duplicate = client.post(path + "/approve", headers=headers, json={"revision": 2})
    assert duplicate.json()["approved_deadline_ids"] == approved.json()["approved_deadline_ids"]
    deadlines = client.get("/api/deadlines", headers=headers).json()
    assert len(deadlines) == 1
    assert deadlines[0]["title"] == "수정한 마감 제목"
    assert deadlines[0]["source_id"] == source_id
    assert deadlines[0]["is_confirmed"] is True
    assert deadlines[0]["safety_buffer_minutes"] is None
    assert deadlines[0]["safe_due_at"] is None
    assert client.patch(path, headers=headers, json=edit_payload(reviewed.json())).status_code == 409


def test_excluded_candidates_do_not_create_deadlines():
    analysis, _, headers = ready_analysis()
    payload = edit_payload(analysis)
    payload["candidates"][0]["selected"] = False
    path = f"/api/ai-analyses/{analysis['id']}"
    assert client.patch(path, headers=headers, json=payload).status_code == 200
    assert client.post(path + "/approve", headers=headers, json={"revision": 2}).status_code == 422
    assert client.post(path + "/reject", headers=headers, json={"revision": 2}).json()["status"] == "rejected"
    assert client.get("/api/deadlines", headers=headers).json() == []


def test_changed_source_blocks_old_result():
    analysis, source_id, headers = ready_analysis()
    client.patch(f"/api/sources/{source_id}", headers=headers, json={"original_text": "다른 내용"})
    path = f"/api/ai-analyses/{analysis['id']}/approve"
    assert client.post(path, headers=headers, json={"revision": 1}).status_code == 409
    client.post(f"/api/sources/{source_id}/analyze", headers=headers)
    assert client.post(path, headers=headers, json={"revision": 1}).status_code == 409
    assert client.get("/api/deadlines", headers=headers).json() == []


def test_other_user_cannot_access_results():
    analysis, source_id, _ = ready_analysis()
    other = auth_headers(f"other-{uuid.uuid4().hex}@example.com")
    path = f"/api/ai-analyses/{analysis['id']}"
    assert client.get(path).status_code == 401
    assert client.get(path, headers=other).status_code == 404
    assert client.patch(path, headers=other, json=edit_payload(analysis)).status_code == 404
    assert client.post(path + "/approve", headers=other, json={"revision": 1}).status_code == 404
    assert client.get(f"/api/sources/{source_id}/ai-analyses", headers=other).status_code == 404
    assert client.post(f"/api/sources/{source_id}/ai-analyses", headers=other,
                       json={"allow_external_ai": True}).status_code == 404


def test_consent_and_missing_configuration(monkeypatch):
    source_id, headers = source_and_headers()
    path = f"/api/sources/{source_id}/ai-analyses"
    assert client.post(path, headers=headers, json={}).status_code == 422
    assert client.post(path, headers=headers, json={"allow_external_ai": False}).status_code == 422
    monkeypatch.setattr(service, "get_settings", lambda: SimpleNamespace(gemini_api_key=None))
    response = client.post(path, headers=headers, json={"allow_external_ai": True})
    assert response.status_code == 503
    assert response.json()["detail"] == "ai_not_configured"
    assert client.get(path, headers=headers).json() == []


def test_capacity_and_input_limits():
    source_id, headers = source_and_headers()
    path = f"/api/sources/{source_id}/ai-analyses"
    service.slots.acquire()
    try:
        assert client.post(path, headers=headers, json={"allow_external_ai": True}).status_code == 429
    finally:
        service.slots.release()
    with TestingSession() as db:
        source = db.get(Source, uuid.UUID(source_id))
        source.extracted_text = "x" * (service.MAX_INPUT + 1)
        db.commit()
    assert client.post(path, headers=headers, json={"allow_external_ai": True}).status_code == 422


def test_ai_failure_is_safe_and_retryable(monkeypatch):
    source_id, headers = source_and_headers()
    path = f"/api/sources/{source_id}/ai-analyses"
    def fail(*args):
        raise RuntimeError("provider secret must not leak")
    monkeypatch.setattr(service, "analyze_text", fail)
    response = client.post(path, headers=headers, json={"allow_external_ai": True})
    result = client.get(f"/api/ai-analyses/{response.json()['id']}", headers=headers).json()
    assert result["status"] == "failed"
    assert result["error_message"] == "ai_processing_failed"
    assert "provider secret" not in json.dumps(result)
    assert client.post(path, headers=headers, json={"allow_external_ai": True}).status_code == 202


def test_due_date_and_candidate_identity_validation():
    analysis, _, headers = ready_analysis()
    path = f"/api/ai-analyses/{analysis['id']}"
    payload = edit_payload(analysis)
    payload["candidates"][0]["due_at"] = "2026-10-05T18:00:00"
    assert client.patch(path, headers=headers, json=payload).status_code == 422
    payload["candidates"][0]["due_at"] = None
    assert client.patch(path, headers=headers, json=payload).status_code == 200
    assert client.post(path + "/approve", headers=headers, json={"revision": 2}).status_code == 422
    payload["revision"] = 2
    payload["candidates"][0]["id"] = str(uuid.uuid4())
    assert client.patch(path, headers=headers, json=payload).status_code == 422


def test_real_adapter_validates_schema_and_evidence(monkeypatch):
    original = REAL_ANALYZE_TEXT
    envelope = {"candidates": [{"finishReason": "STOP", "content": {"parts": [{
        "text": json.dumps({"deadlines": [PROPOSAL], "warnings": []}),
    }]}}]}
    def provider(payload, model):
        output_format = payload["generationConfig"]["responseFormat"]["text"]
        assert output_format["mimeType"] == "APPLICATION_JSON"
        assert "schema" in output_format
        return envelope
    monkeypatch.setattr(service, "provider_request", provider)
    assert original(TEXT, "test-model").deadlines[0].title == PROPOSAL["title"]
    with pytest.raises(service.AIError, match="ai_evidence_not_in_source"):
        original("not the original", "test-model")
    envelope["candidates"][0]["finishReason"] = "MAX_TOKENS"
    with pytest.raises(service.AIError, match="ai_incomplete_result"):
        original(TEXT, "test-model")


@pytest.mark.parametrize("expires,ambiguous", [
    ("2026-10-31", True), ("2026-10-31T23:59", True),
    ("2026-10-31T23:59:00+09:00", False),
])
def test_html_metadata_ambiguity_is_enforced_even_if_model_guesses(monkeypatch, expires, ambiguous):
    from app.services import extraction
    from tests.test_job_metadata import JOB, JOB_URL, job_markup

    text = extraction.parse_page(job_markup({**JOB, "validThrough": expires}), "text/html", JOB_URL).text
    proposal = {**PROPOSAL, "due_at": "2026-10-31T23:59:00+09:00", "evidence_text": expires}
    envelope = {"candidates": [{"finishReason": "STOP", "content": {"parts": [{
        "text": json.dumps({"deadlines": [proposal], "warnings": []}),
    }]}}]}
    monkeypatch.setattr(service, "provider_request", lambda *a: envelope)
    result = REAL_ANALYZE_TEXT(text, "test-model")
    if ambiguous:
        assert result.deadlines[0].due_at is None
        assert any(item in result.warnings for item in extraction.STRUCTURED_DATE_NOTICES)
    else:
        assert result.deadlines[0].due_at.isoformat() == proposal["due_at"]
        assert result.warnings == []


def test_job_metadata_is_stored_and_requires_manual_date_confirmation(monkeypatch):
    from app.services import extraction
    from tests.test_job_metadata import JOB_URL, job_markup

    original_url = JOB_URL + "?Oem_Code=C1&logpath=1#seq=0"
    headers = auth_headers(f"metadata-{uuid.uuid4().hex}@example.com")
    response = client.post("/api/sources", headers=headers, json={
        "source_type": "url", "original_url": original_url, "title": "내 공고 제목",
    })
    source_id = response.json()["id"]
    monkeypatch.setattr(extraction, "public_target", lambda *a: ("www.jobkorea.co.kr", 443, "8.8.8.8"))
    monkeypatch.setattr(extraction, "check_robots", lambda *a: None)
    monkeypatch.setattr(extraction, "fetch_once", lambda *a: (200, {"content-type": "text/html"}, job_markup()))
    assert client.post(f"/api/sources/{source_id}/analyze", headers=headers).status_code == 202
    source = client.get(f"/api/sources/{source_id}", headers=headers).json()
    assert source["processing_status"] == "extracted"
    assert source["title"] == "내 공고 제목" and source["original_url"] == original_url
    assert "2026-10-31T23:59" in source["extracted_text"]
    proposal = {**PROPOSAL, "due_at": "2026-10-31T23:59:00+09:00", "evidence_text": "2026-10-31T23:59"}
    envelope = {"candidates": [{"finishReason": "STOP", "content": {"parts": [{
        "text": json.dumps({"deadlines": [proposal], "warnings": []}),
    }]}}]}
    monkeypatch.setattr(service, "provider_request", lambda *a: envelope)
    monkeypatch.setattr(service, "analyze_text", REAL_ANALYZE_TEXT)
    response = client.post(f"/api/sources/{source_id}/ai-analyses", headers=headers,
                           json={"allow_external_ai": True})
    assert response.status_code == 202
    path = f"/api/ai-analyses/{response.json()['id']}"
    analysis = client.get(path, headers=headers).json()
    assert analysis["status"] == "ready" and analysis["warnings"]
    assert analysis["input_text"] == source["extracted_text"]
    assert analysis["candidates"][0]["due_at"] is None
    assert analysis["candidates"][0]["selected"] is False
    assert client.post(path + "/auto-register", headers=headers, json={
        "revision": 1, "title": "내 공고 제목", "confirm_auto_registration": True,
    }).status_code == 422
    assert client.post(path + "/approve", headers=headers, json={"revision": 1}).status_code == 422
    assert client.get("/api/deadlines", headers=headers).json() == []
    payload = edit_payload(analysis)
    payload["candidates"][0].update(due_at=proposal["due_at"], selected=True, title="내 공고 제목")
    assert client.patch(path, headers=headers, json=payload).status_code == 200
    assert client.post(path + "/approve", headers=headers, json={"revision": 2}).status_code == 200
    deadlines = client.get("/api/deadlines", headers=headers).json()
    assert len(deadlines) == 1 and deadlines[0]["title"] == "내 공고 제목"
    assert deadlines[0]["source_id"] == source_id


def test_processing_conflict_and_missing_extraction():
    from app.models.analysis import Analysis

    source_id, headers = source_and_headers()
    with TestingSession() as db:
        db.add(Analysis(user_id=db.get(Source, uuid.UUID(source_id)).user_id,
                        source_id=uuid.UUID(source_id), input_text=TEXT,
                        input_hash=service.content_hash(TEXT), model="test-model"))
        db.commit()
    path = f"/api/sources/{source_id}/ai-analyses"
    assert client.post(path, headers=headers, json={"allow_external_ai": True}).status_code == 409
    client.patch(f"/api/sources/{source_id}", headers=headers, json={"original_text": "new"})
    assert client.post(path, headers=headers, json={"allow_external_ai": True}).status_code == 409


def test_empty_result_is_not_a_fake_deadline(monkeypatch):
    monkeypatch.setattr(service, "analyze_text", lambda *a: ProviderResult(deadlines=[], warnings=[]))
    analysis, _, headers = ready_analysis()
    assert analysis["candidates"] == []
    path = f"/api/ai-analyses/{analysis['id']}/approve"
    assert client.post(path, headers=headers, json={"revision": 1}).status_code == 422
    assert client.get("/api/deadlines", headers=headers).json() == []


def test_source_delete_removes_analysis():
    analysis, source_id, headers = ready_analysis()
    assert client.delete(f"/api/sources/{source_id}", headers=headers).status_code == 204
    assert client.get(f"/api/ai-analyses/{analysis['id']}", headers=headers).status_code == 404


def automatic_ready():
    analysis, source_id, headers = ready_analysis()
    assert client.patch(f"/api/sources/{source_id}", headers=headers,
                        json={"title": "사용자가 설정한 제목"}).status_code == 200
    return analysis, source_id, headers


def automatic_payload(analysis):
    return {"revision": analysis["revision"], "title": "사용자가 설정한 제목",
            "confirm_auto_registration": True}


def test_auto_registration_uses_requested_title_and_is_idempotent():
    analysis, source_id, headers = automatic_ready()
    path = f"/api/ai-analyses/{analysis['id']}/auto-register"
    result = client.post(path, headers=headers, json=automatic_payload(analysis))
    assert result.status_code == 200
    assert result.json()["status"] == "approved"
    assert result.json()["candidates"][0]["title"] == "사용자가 설정한 제목"
    assert result.json()["revision"] == 2
    repeat = client.post(path, headers=headers, json=automatic_payload(analysis))
    assert repeat.json()["approved_deadline_ids"] == result.json()["approved_deadline_ids"]
    deadlines = client.get("/api/deadlines", headers=headers).json()
    assert len(deadlines) == 1 and deadlines[0]["title"] == "사용자가 설정한 제목"
    assert deadlines[0]["source_id"] == source_id
    assert deadlines[0]["safety_buffer_minutes"] is None
    assert client.get("/api/tasks", headers=headers).json() == []
    assert client.get("/api/scheduled-events", headers=headers).json() == []


@pytest.mark.parametrize("kind", ["none", "multiple", "missing_date", "warning", "edited", "excluded"])
def test_auto_registration_requires_review_for_ambiguous_results(kind):
    from app.models.analysis import Analysis

    analysis, _, headers = automatic_ready()
    with TestingSession() as db:
        saved = db.get(Analysis, uuid.UUID(analysis["id"]))
        if kind == "none":
            saved.candidates = []
        elif kind == "multiple":
            saved.candidates = [*saved.candidates, dict(saved.candidates[0], id=str(uuid.uuid4()))]
        elif kind == "missing_date":
            saved.candidates = [dict(saved.candidates[0], due_at=None)]
        elif kind == "warning":
            saved.warnings = ["날짜를 확인하세요"]
        elif kind == "edited":
            saved.revision = 2
            analysis["revision"] = 2
        else:
            saved.candidates = [dict(saved.candidates[0], selected=False)]
        db.commit()
    result = client.post(f"/api/ai-analyses/{analysis['id']}/auto-register", headers=headers,
                         json=automatic_payload(analysis))
    assert result.status_code == 422 and result.json()["detail"] == "auto_registration_requires_review"
    assert client.get("/api/deadlines", headers=headers).json() == []


@pytest.mark.parametrize("override", [{"confirm_auto_registration": False},
                                      {"title": "   "}, {"title": "x" * 256}])
def test_auto_registration_requires_valid_title_and_consent(override):
    analysis, _, headers = automatic_ready()
    result = client.post(f"/api/ai-analyses/{analysis['id']}/auto-register", headers=headers,
                         json=automatic_payload(analysis) | override)
    assert result.status_code == 422
    assert client.get("/api/deadlines", headers=headers).json() == []


def test_auto_registration_source_change_rolls_back_title_and_revision():
    analysis, source_id, headers = automatic_ready()
    path = f"/api/ai-analyses/{analysis['id']}"
    assert client.post(path + "/auto-register", headers=headers,
                       json=automatic_payload(analysis) | {"title": "다른 제목"}).status_code == 409
    client.patch(f"/api/sources/{source_id}", headers=headers, json={"original_text": "변경된 원문"})
    assert client.post(path + "/auto-register", headers=headers,
                       json=automatic_payload(analysis)).status_code == 409
    unchanged = client.get(path, headers=headers).json()
    assert unchanged["revision"] == 1 and unchanged["candidates"] == analysis["candidates"]
    assert client.get("/api/deadlines", headers=headers).json() == []


def test_auto_registration_owner_revision_and_consent_protection():
    analysis, _, headers = automatic_ready()
    path = f"/api/ai-analyses/{analysis['id']}/auto-register"
    payload = automatic_payload(analysis)
    assert client.post(path, json=payload).status_code == 401
    other = auth_headers(f"auto-other-{uuid.uuid4().hex}@example.com")
    assert client.post(path, headers=other, json=payload).status_code == 404
    assert client.post(path, headers=headers, json=payload | {"revision": 2}).status_code == 409
    del payload["confirm_auto_registration"]
    assert client.post(path, headers=headers, json=payload).status_code == 422
    assert client.get("/api/deadlines", headers=headers).json() == []
