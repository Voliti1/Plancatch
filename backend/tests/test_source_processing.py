"""Stored extraction outcomes, retries, and processing conflicts."""

import uuid

import pytest

from app.models.source import Source
from app.services.extraction import ExtractionError
from tests.test_auth import TestingSession
from tests.test_sources import auth_headers, client, configure_test_jwt  # noqa: F401


def new_source():
    headers = auth_headers(f"extract-{uuid.uuid4().hex}@example.com")
    response = client.post("/api/sources", headers=headers, json={
        "source_type": "text", "original_text": "Submit by October 1.",
    })
    return headers, response.json()["id"]


@pytest.mark.parametrize("reason,state", [
    ("requires_login", "requires_login"), ("unsafe_url", "failed"),
])
def test_failed_extraction_can_be_retried(monkeypatch, reason, state):
    headers, source_id = new_source()
    with monkeypatch.context() as patch:
        def fail(*args):
            raise ExtractionError(reason)
        patch.setattr("app.services.source_processing.extract", fail)
        assert client.post(f"/api/sources/{source_id}/analyze", headers=headers).status_code == 202
    result = client.get(f"/api/sources/{source_id}", headers=headers).json()
    assert result["processing_status"] == state
    assert result["error_message"] == reason
    assert client.post(f"/api/sources/{source_id}/analyze", headers=headers).status_code == 202
    result = client.get(f"/api/sources/{source_id}", headers=headers).json()
    assert result["processing_status"] == "extracted"
    assert result["error_message"] is None


def test_processing_blocks_duplicates_and_mutations():
    headers, source_id = new_source()
    with TestingSession() as db:
        source = db.get(Source, uuid.UUID(source_id))
        source.processing_status = "processing"
        db.commit()
    path = f"/api/sources/{source_id}"
    assert client.post(path + "/analyze", headers=headers).status_code == 409
    assert client.patch(path, headers=headers, json={"original_text": "changed"}).status_code == 409
    assert client.delete(path, headers=headers).status_code == 409


def test_content_edit_invalidates_extracted_text():
    headers, source_id = new_source()
    path = f"/api/sources/{source_id}"
    client.post(path + "/analyze", headers=headers)
    result = client.patch(path, headers=headers, json={"original_text": "new content"}).json()
    assert result["processing_status"] == "pending"
    assert result["extracted_text"] is None


def test_extraction_capacity_returns_retryable_error():
    from app.services.source_processing import slots

    headers, source_id = new_source()
    slots.acquire()
    slots.acquire()
    try:
        assert client.post(f"/api/sources/{source_id}/analyze", headers=headers).status_code == 429
        result = client.get(f"/api/sources/{source_id}", headers=headers).json()
        assert result["processing_status"] == "pending"
    finally:
        slots.release()
        slots.release()


def test_analysis_requires_authentication():
    headers, source_id = new_source()
    assert client.post(f"/api/sources/{source_id}/analyze").status_code == 401
    assert client.get(f"/api/sources/{source_id}", headers=headers).json()["processing_status"] == "pending"
