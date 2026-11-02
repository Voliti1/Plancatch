"""Immediate review launch reuses snapshots without repeated external AI calls."""
import uuid

from app.models.analysis import Analysis
from app.services import ai_analysis as service
from tests.test_ai_analyses import TEXT, source_and_headers
from tests.test_ai_analyses import fake_provider as fake_provider  # noqa: PLC0414
from tests.test_auth import TestingSession
from tests.test_sources import client, configure_test_jwt  # noqa: F401


def test_snapshot_response_and_repeated_launch_reuse_completed_analysis(monkeypatch):
    source_id, headers = source_and_headers()
    path = f"/api/sources/{source_id}"
    source = client.get(path, headers=headers).json()
    assert source["extracted_text_hash"] == service.content_hash(TEXT)
    calls = []
    original = service.analyze_text
    def provider(*args):
        calls.append(True)
        return original(*args)
    monkeypatch.setattr(service, "analyze_text", provider)
    payload = {"allow_external_ai": True, "reuse_existing": True,
               "input_hash": source["extracted_text_hash"]}
    first = client.post(path+"/ai-analyses", headers=headers, json=payload)
    second = client.post(path+"/ai-analyses", headers=headers, json=payload)
    assert first.status_code == second.status_code == 202
    assert first.json()["id"] == second.json()["id"] and calls == [True]
    with TestingSession() as db:
        row = db.get(Analysis, uuid.UUID(first.json()["id"]))
        row.status, row.error_message = "failed", "ai_timeout"
        db.commit()
    failed = client.post(path+"/ai-analyses", headers=headers, json=payload)
    assert failed.json()["id"] == first.json()["id"] and failed.json()["status"] == "failed"
    assert calls == [True]  # Viewing a failed attempt must not silently spend another request.


def test_changed_snapshot_or_missing_consent_never_calls_provider(monkeypatch):
    source_id, headers = source_and_headers()
    calls = []
    monkeypatch.setattr(service, "analyze_text", lambda *_: calls.append(True))
    path = f"/api/sources/{source_id}/ai-analyses"
    payload = {"allow_external_ai": True, "reuse_existing": True, "input_hash": "0"*64}
    assert client.post(path, headers=headers, json=payload).status_code == 409
    payload["input_hash"] = service.content_hash(TEXT)
    payload["allow_external_ai"] = False
    assert client.post(path, headers=headers, json=payload).status_code == 422
    assert client.post(path, headers=headers, json={"reuse_existing": True}).status_code == 422
    assert calls == []


def test_pending_source_hash_absent_and_changed_source_requires_new_consent():
    source_id, headers = source_and_headers()
    path = f"/api/sources/{source_id}"
    old = client.get(path, headers=headers).json()["extracted_text_hash"]
    client.patch(path, headers=headers, json={"original_text": "수정된 공고: 마감 미정"})
    assert client.get(path, headers=headers).json()["extracted_text_hash"] is None
    client.post(path+"/analyze", headers=headers)
    assert client.post(path+"/ai-analyses", headers=headers, json={
        "allow_external_ai": True, "reuse_existing": True, "input_hash": old}).status_code == 409
