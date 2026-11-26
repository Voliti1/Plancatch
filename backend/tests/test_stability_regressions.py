"""Regression coverage for extraction, validation, timezone and docs boundaries."""
import uuid
from threading import BoundedSemaphore
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from app.api.routes import sources
from app.schemas.analysis import ProviderResult
from app.schemas.source import SourceCreate, SourceUpdate
from app.schemas.user import UserCreate
from app.services.ai_analysis import apply_timezone_policy
from fastapi.testclient import TestClient
from pydantic import ValidationError


@pytest.mark.parametrize("failure", ["refresh", "add_task"])
def test_source_slot_released_after_commit_failure(monkeypatch, failure):
    slots = BoundedSemaphore(1)
    source = SimpleNamespace(id=uuid.uuid4(), source_type="text")
    db = MagicMock()
    db.execute.return_value.rowcount = 1
    tasks = MagicMock()
    getattr(db if failure == "refresh" else tasks, failure).side_effect = RuntimeError("injected")
    monkeypatch.setattr(sources, "slots", slots)
    monkeypatch.setattr(sources, "get_owned_source", lambda *_: source)
    monkeypatch.setattr(sources, "begin_processing", lambda s: setattr(s, "processing_lease_until", None))
    with pytest.raises(RuntimeError, match="injected"):
        sources.request_source_analysis(source.id, tasks, SimpleNamespace(id=uuid.uuid4()), db)
    db.commit.assert_called_once()
    db.rollback.assert_called_once()
    assert slots.acquire(blocking=False)
    slots.release()


def test_missing_evidence_does_not_use_unrelated_timezone_context():
    result = ProviderResult(deadlines=[{"title": "Deadline", "evidence_text": "2026-12-01T15:00", "confidence": 1}])
    assert apply_timezone_policy(result, "Unrelated UTC announcement")
    assert result.deadlines[0].due_at.isoformat() == "2026-12-01T15:00:00+09:00"


def test_blank_display_name_is_null():
    assert UserCreate(email="a@example.com", password="password123", display_name="   ").display_name is None


@pytest.mark.parametrize("schema", [SourceCreate, SourceUpdate])
def test_original_text_length_boundary(schema):
    kwargs = {"source_type": "text"} if schema is SourceCreate else {}
    assert len(schema(original_text="a" * 100_000, **kwargs).original_text) == 100_000
    with pytest.raises(ValidationError):
        schema(original_text="a" * 100_001, **kwargs)


@pytest.mark.parametrize("environment,status", [("production", 404), ("PrOdUcTiOn", 404), ("development", 200)])
def test_documentation_visibility(monkeypatch, environment, status):
    from app import main
    from app.core.config import Settings
    monkeypatch.setattr(main, "get_settings", lambda: Settings(_env_file=None, app_env=environment))
    client = TestClient(main.create_app())
    for path in ["/docs", "/redoc", "/openapi.json"]:
        assert client.get(path).status_code == status
    assert client.get("/health").status_code == 200
