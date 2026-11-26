"""Tests for the public health endpoints."""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.exc import OperationalError
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_root() -> None:
    response = client.get("/")

    assert response.status_code == 200
    assert response.json() == {"message": "PlanCatch API"}


def test_health(monkeypatch) -> None:
    factory = sessionmaker(bind=create_engine("sqlite://"))
    monkeypatch.setattr("app.api.routes.health.get_session_factory", lambda: factory)
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.parametrize("failure", [OperationalError("private database details", {}, Exception("secret")), RuntimeError("private configuration")])
def test_health_database_failure_is_sanitized(monkeypatch, failure):
    def unavailable():
        raise failure
    monkeypatch.setattr("app.api.routes.health.get_session_factory", unavailable)
    response = client.get("/health")
    assert response.status_code == 503
    assert response.json() == {"detail": "database_unavailable"}
