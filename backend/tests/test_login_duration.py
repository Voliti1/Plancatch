"""24-hour login lifetime, fixed expiry, and password-change revocation."""

import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest

from app.core import security
from app.core.config import Settings
from tests.test_auth import client


@pytest.fixture
def day_session(monkeypatch):
    monkeypatch.delenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", raising=False)
    settings = Settings(
        _env_file=None,
        jwt_secret_key="test-only-session-duration-secret-at-least-32-bytes",
    )
    assert settings.jwt_access_token_expire_minutes == 1440
    monkeypatch.setattr(security, "get_settings", lambda: settings)
    monkeypatch.setattr("app.api.routes.auth.get_settings", lambda: settings)
    moment = [datetime(2026, 11, 10, 3, tzinfo=UTC)]

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            value = moment[0].astimezone(tz) if tz else moment[0].replace(tzinfo=None)
            return cls.fromtimestamp(value.timestamp(), tz=value.tzinfo)

    monkeypatch.setattr(security, "datetime", Clock)
    monkeypatch.setattr(jwt.api_jwt, "datetime", Clock)
    email = uuid.uuid4().hex + "@example.com"
    assert (
        client.post(
            "/api/auth/signup",
            json={"email": email, "password": "duration-password-123"},
        ).status_code
        == 201
    )
    result = client.post(
        "/api/auth/login", json={"email": email, "password": "duration-password-123"}
    )
    assert result.status_code == 200 and result.json()["expires_in"] == 86400
    token = result.json()["access_token"]
    return moment, {"Authorization": "Bearer " + token}, token


def test_login_remains_valid_after_inactivity_but_expires_exactly_24_hours(day_session):
    moment, headers, token = day_session
    issued = moment[0]
    expiry = security.decode_access_claims(token)["exp"]
    assert expiry == int((issued + timedelta(hours=24)).timestamp())
    moment[0] = issued + timedelta(hours=23, minutes=59, seconds=59)
    assert client.get("/api/auth/me", headers=headers).status_code == 200
    # Reading a protected API does not silently extend the fixed login lifetime.
    assert security.decode_access_claims(token)["exp"] == expiry
    moment[0] = issued + timedelta(hours=24)
    assert client.get("/api/auth/me", headers=headers).status_code == 401


def test_password_change_still_revokes_old_24_hour_login_and_renews_new_token(
    day_session,
):
    moment, headers, _ = day_session
    moment[0] += timedelta(hours=2)
    response = client.post(
        "/api/auth/password",
        headers=headers,
        json={
            "current_password": "duration-password-123",
            "new_password": "duration-new-password-456",
        },
    )
    assert response.status_code == 200 and response.json()["expires_in"] == 86400
    token = response.json()["access_token"]
    assert security.decode_access_claims(token)["exp"] == int(
        (moment[0] + timedelta(hours=24)).timestamp()
    )
    assert client.get("/api/auth/me", headers=headers).status_code == 401
    assert (
        client.get(
            "/api/auth/me", headers={"Authorization": "Bearer " + token}
        ).status_code
        == 200
    )
