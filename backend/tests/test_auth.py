"""Tests for account registration."""

from collections.abc import Generator
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.session import get_db
from app.main import app

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
Base.metadata.create_all(engine)


def override_get_db() -> Generator[Session, None, None]:
    with TestingSession() as session:
        yield session


app.dependency_overrides[get_db] = override_get_db
client = TestClient(app)


@pytest.fixture(autouse=True)
def configure_test_jwt(monkeypatch: pytest.MonkeyPatch) -> None:
    """Use a non-production signing key during authentication tests."""
    settings = SimpleNamespace(
        jwt_secret_key=SecretStr("test-only-secret-key-with-32-bytes"),
        jwt_algorithm="HS256",
        jwt_access_token_expire_minutes=30,
    )
    monkeypatch.setattr("app.core.security.get_settings", lambda: settings)
    monkeypatch.setattr("app.api.routes.auth.get_settings", lambda: settings)


def test_signup_creates_user_without_returning_password() -> None:
    response = client.post(
        "/api/auth/signup",
        json={
            "email": "NewUser@Example.com",
            "password": "secure-password",
            "display_name": "Plan Catcher",
        },
    )

    assert response.status_code == 201
    assert response.json()["email"] == "newuser@example.com"
    assert response.json()["display_name"] == "Plan Catcher"
    assert "password" not in response.json()
    assert "password_hash" not in response.json()


def test_signup_rejects_duplicate_email() -> None:
    first_response = client.post(
        "/api/auth/signup",
        json={
            "email": "duplicate@example.com",
            "password": "secure-password",
        },
    )
    response = client.post(
        "/api/auth/signup",
        json={
            "email": "DUPLICATE@example.com",
            "password": "another-password",
        },
    )

    assert first_response.status_code == 201
    assert response.status_code == 409


def test_signup_validates_email_and_password() -> None:
    response = client.post(
        "/api/auth/signup",
        json={"email": "not-an-email", "password": "short"},
    )

    assert response.status_code == 422


def test_login_returns_token_and_me_returns_user() -> None:
    signup_response = client.post(
        "/api/auth/signup",
        json={
            "email": "login-user@example.com",
            "password": "login-password",
            "display_name": "Login User",
        },
    )
    login_response = client.post(
        "/api/auth/login",
        json={"email": "LOGIN-USER@example.com", "password": "login-password"},
    )

    assert signup_response.status_code == 201
    assert login_response.status_code == 200
    token = login_response.json()["access_token"]
    assert login_response.json()["token_type"] == "bearer"
    assert login_response.json()["expires_in"] == 1800

    me_response = client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert me_response.status_code == 200
    assert me_response.json()["email"] == "login-user@example.com"


def test_login_rejects_invalid_credentials() -> None:
    response = client.post(
        "/api/auth/login",
        json={"email": "missing@example.com", "password": "wrong-password"},
    )

    assert response.status_code == 401


def test_me_rejects_invalid_token() -> None:
    response = client.get(
        "/api/auth/me",
        headers={"Authorization": "Bearer not-a-valid-token"},
    )

    assert response.status_code == 401
