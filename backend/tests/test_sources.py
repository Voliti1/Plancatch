"""Tests for authenticated source-material CRUD endpoints."""

from types import SimpleNamespace

import pytest
from pydantic import SecretStr

from tests.test_auth import client


@pytest.fixture(autouse=True)
def configure_test_jwt(monkeypatch: pytest.MonkeyPatch) -> None:
    """Use a non-production signing key during source API tests."""
    settings = SimpleNamespace(
        jwt_secret_key=SecretStr("test-only-secret-key-with-32-bytes"),
        jwt_algorithm="HS256",
        jwt_access_token_expire_minutes=30,
    )
    monkeypatch.setattr("app.core.security.get_settings", lambda: settings)
    monkeypatch.setattr("app.api.routes.auth.get_settings", lambda: settings)


def auth_headers(email: str) -> dict[str, str]:
    """Create a test user and return a bearer authorization header."""
    password = "source-test-password"
    signup_response = client.post(
        "/api/auth/signup",
        json={"email": email, "password": password},
    )
    assert signup_response.status_code == 201

    login_response = client.post(
        "/api/auth/login",
        json={"email": email, "password": password},
    )
    assert login_response.status_code == 200
    token = login_response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_source_crud_flow() -> None:
    headers = auth_headers("source-owner@example.com")
    create_response = client.post(
        "/api/sources",
        headers=headers,
        json={
            "source_type": "url",
            "title": "Original title",
            "original_url": "https://example.com/recruitment",
        },
    )

    assert create_response.status_code == 201
    source_id = create_response.json()["id"]
    assert create_response.json()["processing_status"] == "pending"

    list_response = client.get("/api/sources", headers=headers)
    assert list_response.status_code == 200
    assert [item["id"] for item in list_response.json()] == [source_id]

    update_response = client.patch(
        f"/api/sources/{source_id}",
        headers=headers,
        json={"title": "Updated title"},
    )
    assert update_response.status_code == 200
    assert update_response.json()["title"] == "Updated title"

    delete_response = client.delete(f"/api/sources/{source_id}", headers=headers)
    assert delete_response.status_code == 204

    missing_response = client.get(f"/api/sources/{source_id}", headers=headers)
    assert missing_response.status_code == 404


def test_sources_require_authentication() -> None:
    response = client.get("/api/sources")

    assert response.status_code == 401


def test_user_cannot_read_another_users_source() -> None:
    owner_headers = auth_headers("first-source-owner@example.com")
    other_headers = auth_headers("second-source-owner@example.com")
    create_response = client.post(
        "/api/sources",
        headers=owner_headers,
        json={
            "source_type": "text",
            "title": "Private source",
            "original_text": "This belongs to the first user.",
        },
    )
    source_id = create_response.json()["id"]

    response = client.get(f"/api/sources/{source_id}", headers=other_headers)

    assert response.status_code == 404
