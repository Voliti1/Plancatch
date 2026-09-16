"""Tests for authenticated deadline CRUD endpoints."""

from types import SimpleNamespace

import pytest
from pydantic import SecretStr

from tests.test_sources import auth_headers, client


@pytest.fixture(autouse=True)
def configure_test_jwt(monkeypatch: pytest.MonkeyPatch) -> None:
    """Use a non-production signing key during deadline API tests."""
    settings = SimpleNamespace(
        jwt_secret_key=SecretStr("test-only-secret-key-with-32-bytes"),
        jwt_algorithm="HS256",
        jwt_access_token_expire_minutes=30,
    )
    monkeypatch.setattr("app.core.security.get_settings", lambda: settings)
    monkeypatch.setattr("app.api.routes.auth.get_settings", lambda: settings)


def test_deadline_crud_flow() -> None:
    headers = auth_headers("deadline-owner@example.com")
    source_response = client.post(
        "/api/sources",
        headers=headers,
        json={
            "source_type": "text",
            "title": "Recruitment notice",
            "original_text": "Applications close on September 30.",
        },
    )
    source_id = source_response.json()["id"]

    create_response = client.post(
        "/api/deadlines",
        headers=headers,
        json={
            "source_id": source_id,
            "title": "Application deadline",
            "due_at": "2026-09-30T18:00:00+09:00",
            "deadline_type": "application",
            "confidence": "0.9500",
            "evidence_text": "Applications close on September 30.",
        },
    )
    assert create_response.status_code == 201
    deadline_id = create_response.json()["id"]
    assert create_response.json()["source_id"] == source_id

    list_response = client.get("/api/deadlines", headers=headers)
    assert list_response.status_code == 200
    assert [item["id"] for item in list_response.json()] == [deadline_id]

    update_response = client.patch(
        f"/api/deadlines/{deadline_id}",
        headers=headers,
        json={"title": "Confirmed deadline", "is_confirmed": True},
    )
    assert update_response.status_code == 200
    assert update_response.json()["title"] == "Confirmed deadline"
    assert update_response.json()["is_confirmed"] is True

    delete_response = client.delete(
        f"/api/deadlines/{deadline_id}",
        headers=headers,
    )
    assert delete_response.status_code == 204


def test_deadline_requires_timezone() -> None:
    headers = auth_headers("deadline-timezone@example.com")
    response = client.post(
        "/api/deadlines",
        headers=headers,
        json={
            "title": "No timezone",
            "due_at": "2026-09-30T18:00:00",
        },
    )

    assert response.status_code == 422


def test_deadline_cannot_link_another_users_source() -> None:
    owner_headers = auth_headers("deadline-source-owner@example.com")
    other_headers = auth_headers("deadline-other-user@example.com")
    source_response = client.post(
        "/api/sources",
        headers=owner_headers,
        json={
            "source_type": "text",
            "original_text": "Private source text",
        },
    )

    response = client.post(
        "/api/deadlines",
        headers=other_headers,
        json={
            "source_id": source_response.json()["id"],
            "title": "Unauthorized link",
            "due_at": "2026-10-01T09:00:00+09:00",
        },
    )

    assert response.status_code == 404
