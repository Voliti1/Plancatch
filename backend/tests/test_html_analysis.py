"""Deterministic Saramin URL analysis and registration; no network/provider/user DB writes."""
import uuid

import pytest

from app.models import Analysis, Source
from app.services import ai_analysis as ai
from app.services.html_analysis import HTML_MODEL, analyze_period, matching_period
from app.services.saramin_period import CONFLICT
from tests.test_auth import TestingSession
from tests.test_saramin_period import END, URL, document, markup
from tests.test_sources import auth_headers, client, configure_test_jwt  # noqa: F401


def source_ready(text=None, url=URL, kind="url"):
    headers = auth_headers(f'html-{uuid.uuid4().hex}@example.com')
    payload = {"source_type": kind, "title": "사용자가 설정한 제목"}
    payload["original_url" if kind == "url" else "original_text"] = url if kind == "url" else (text or document().text)
    response = client.post("/api/sources", headers=headers, json=payload)
    assert response.status_code == 201
    source_id = response.json()["id"]
    with TestingSession() as db:
        source = db.get(Source, uuid.UUID(source_id))
        source.extracted_text = text or document().text
        source.processing_status = "extracted"
        db.commit()
    return source_id, headers


def forbid_ai(monkeypatch):
    def forbidden(*args):
        pytest.fail("Saramin HTML analysis must not depend on Gemini/configuration/transport")
    monkeypatch.setattr(ai, "analyze_text", forbidden)
    monkeypatch.setattr(ai, "provider_request", forbidden)
    monkeypatch.setattr("app.api.routes.analyses.configured_model", forbidden)


def test_reported_date_uses_exact_html_proof_without_model_generated_quotes():
    text = document(markup(end="2026.10.16 23:59", start="2026.10.02 00:00")).text
    result = analyze_period(text, URL, "입력 제목")
    assert result.deadlines[0].title == "입력 제목"
    assert result.deadlines[0].due_at.isoformat() == "2026-10-16T23:59:00+09:00"
    assert result.deadlines[0].evidence_text == "마감일 원문: 2026.10.16 23:59"
    assert result.deadlines[0].evidence_text in text and result.warnings == []


@pytest.mark.parametrize("url", [URL, URL.replace("/jobs/view", "/jobs/relay/view") + "&view_type=list#seq=0"])
def test_route_worker_and_idempotent_registration_make_zero_ai_calls(monkeypatch, url):
    forbid_ai(monkeypatch)
    source_id, headers = source_ready(url=url)
    response = client.post(f"/api/sources/{source_id}/ai-analyses", headers=headers,
                           json={"allow_external_ai": True})
    assert response.status_code == 202 and response.json()["model"] == HTML_MODEL
    path = f"/api/ai-analyses/{response.json()['id']}"
    analysis = client.get(path, headers=headers).json()
    assert analysis["status"] == "ready" and analysis["warnings"] == []
    assert analysis["candidates"][0]["evidence_text"] == f"마감일 원문: {END}"
    assert analysis["candidates"][0]["due_at"] == "2026-11-01T23:59:00+09:00"
    assert analysis["candidates"][0]["selected"]
    payload = {"revision": 1, "title": "사용자가 설정한 제목", "confirm_auto_registration": True}
    assert client.post(path + "/auto-register", headers=headers, json=payload).status_code == 422
    first = client.post(path + "/approve", headers=headers, json={"revision": 1})
    again = client.post(path + "/approve", headers=headers, json={"revision": 1})
    assert first.status_code == again.status_code == 200
    assert first.json()["approved_deadline_ids"] == again.json()["approved_deadline_ids"]
    assert len(client.get("/api/deadlines", headers=headers).json()) == 1
    assert client.get("/api/tasks", headers=headers).json() == []
    assert client.get("/api/scheduled-events", headers=headers).json() == []


@pytest.mark.parametrize("text,warning", [
    (document(markup(end="채용시까지")).text, "채용 시 마감"),
    (document(markup() + markup(end="2026.11.02 23:59")).text, CONFLICT),
])
def test_unresolved_periods_are_review_only_not_ai_guesses_or_processing_failures(monkeypatch, text, warning):
    forbid_ai(monkeypatch)
    source_id, headers = source_ready(text)
    created = client.post(f"/api/sources/{source_id}/ai-analyses", headers=headers,
                          json={"allow_external_ai": True})
    assert created.status_code == 202
    path = f"/api/ai-analyses/{created.json()['id']}"
    result = client.get(path, headers=headers).json()
    assert result["status"] == "ready" and any(warning in w for w in result["warnings"])
    assert result["candidates"][0]["due_at"] is None
    assert not result["candidates"][0]["selected"]
    assert result["candidates"][0]["evidence_text"] in text
    response = client.post(path + "/auto-register", headers=headers, json={
        "revision": 1, "title": "사용자가 설정한 제목", "confirm_auto_registration": True,
    })
    assert response.status_code == 422
    assert client.get("/api/deadlines", headers=headers).json() == []


def test_saramin_date_only_prefills_day_end_but_requires_user_approval(monkeypatch):
    forbid_ai(monkeypatch)
    text = document(markup(end="2026.11.01")).text
    source_id, headers = source_ready(text)
    started = client.post(f"/api/sources/{source_id}/ai-analyses", headers=headers, json={})
    path = f"/api/ai-analyses/{started.json()['id']}"
    analysis = client.get(path, headers=headers).json()
    assert analysis["candidates"][0]["due_at"] == "2026-11-01T23:59:00+09:00"
    assert analysis["candidates"][0]["time_defaulted"]
    assert not analysis["candidates"][0]["selected"]
    assert analysis["source_period"]["deadline_at"] == "2026-11-01T23:59:00+09:00"
    assert analysis["source_period"]["time_defaulted"]
    assert client.post(path + "/approve", headers=headers, json={"revision": 1}).status_code == 422
    assert client.get("/api/deadlines", headers=headers).json() == []


@pytest.mark.parametrize("url", [URL.replace("55170548", "99999"),
    URL.replace("www.saramin.co.kr", "saramin.co.kr.evil.example"),
    URL + "&rec_idx=99999", "https://example.com/jobs/view?rec_idx=55170548"])
def test_another_job_or_host_cannot_supply_the_direct_html_deadline(url):
    assert matching_period(document().text, url) is None


@pytest.mark.parametrize("kind,url,text", [
    ("text", URL, document().text),
    ("url", URL, "사람인 일반 본문: 접수 기간 미정"),
    ("url", "https://example.com/jobs", document().text),
])
def test_other_sites_text_and_unrecognized_html_keep_the_existing_ai_path(monkeypatch, kind, url, text):
    calls = []
    def configured():
        calls.append(True)
        raise ai.AIError("ai_not_configured")
    monkeypatch.setattr("app.api.routes.analyses.configured_model", configured)
    source_id, headers = source_ready(text, url, kind)
    response = client.post(f"/api/sources/{source_id}/ai-analyses", headers=headers,
                           json={"allow_external_ai": True})
    if kind == "text":
        assert response.status_code == 503 and calls == [True]
    else:
        assert response.status_code == 202 and calls == []
        result = client.get(f"/api/ai-analyses/{response.json()['id']}", headers=headers).json()
        assert result["status"] == "ready" and result["candidates"][0]["due_at"] is None


def test_consent_ownership_source_hash_and_worker_changes_remain_protected(monkeypatch):
    forbid_ai(monkeypatch)
    source_id, headers = source_ready()
    create = f"/api/sources/{source_id}/ai-analyses"
    assert client.post(create, json={"allow_external_ai": True}).status_code == 401
    assert client.post(create, headers=headers, json={"allow_external_ai": False}).status_code == 202
    other = auth_headers(f'html-other-{uuid.uuid4().hex}@example.com')
    assert client.post(create, headers=other, json={"allow_external_ai": True}).status_code == 404
    created = client.post(create, headers=headers, json={"allow_external_ai": True}).json()
    client.patch(f"/api/sources/{source_id}", headers=headers, json={"original_url": URL.replace("55170548", "99999")})
    response = client.post(f"/api/ai-analyses/{created['id']}/approve", headers=headers, json={"revision": 1})
    assert response.status_code == 409
    assert client.get("/api/deadlines", headers=headers).json() == []
    with TestingSession() as db:
        source = db.get(Source, uuid.UUID(source_id))
        analysis = Analysis(user_id=source.user_id, source_id=source.id, input_text=document().text,
                            input_hash=ai.content_hash(document().text), model=HTML_MODEL)
        db.add(analysis)
        db.commit()
        analysis_id = analysis.id
    assert ai.slots.acquire(blocking=False)
    ai.process_analysis(analysis_id, TestingSession.kw["bind"])
    with TestingSession() as db:
        assert db.get(Analysis, analysis_id).error_message == "ai_input_invalid"
    assert ai.slots.acquire(blocking=False)
    ai.slots.release()
