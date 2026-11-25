"""Tests for account registration."""

from collections.abc import Generator
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import create_engine, event
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


@event.listens_for(engine, "connect")
def enable_foreign_keys(connection, _record):
    connection.execute("PRAGMA foreign_keys=ON")


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



def test_time_zone_is_saved_only_for_the_authenticated_account() -> None:
    def register_and_login(email: str) -> dict[str, str]:
        credentials = {"email": email, "password": "test-time-zone-password"}
        response = client.post("/api/auth/signup", json=credentials)
        assert response.status_code == 201
        assert response.json()["time_zone"] == "Asia/Seoul"
        token = client.post("/api/auth/login", json=credentials).json()["access_token"]
        return {"Authorization": f"Bearer {token}"}

    headers = register_and_login("timezone-one@example.com")
    other = register_and_login("timezone-two@example.com")
    url = "/api/auth/time-zone"
    assert client.patch(url, json={"time_zone": "UTC"}).status_code == 401
    invalid = client.patch(url, headers=headers, json={"time_zone": "GMT+17"})
    assert invalid.status_code == 422
    result = client.patch(url, headers=headers, json={"time_zone": "America/New_York"})
    assert result.status_code == 200
    assert client.get("/api/auth/me", headers=headers).json()["time_zone"] == "America/New_York"
    assert client.get("/api/auth/me", headers=other).json()["time_zone"] == "Asia/Seoul"



def test_google_signin_new_and_existing_accounts(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services import google_login

    settings = SimpleNamespace(
        google_login_client_id="test.apps.googleusercontent.com",
        app_env="development",
        jwt_access_token_expire_minutes=30,
    )
    monkeypatch.setattr("app.api.routes.auth.get_settings", lambda: settings)
    verify = {
        "new": ("google-new-subject", "google-only@example.com", "Google Tester"),
        "existing": ("google-existing-subject", "existing-google@example.com", None),
    }
    nonce = ""

    def verified(credential, client_id, expected_nonce):
        assert client_id == settings.google_login_client_id and expected_nonce == nonce
        return verify[credential]

    monkeypatch.setattr(google_login, "verify_credential", verified)
    with TestClient(app) as browser:
        assert browser.post("/api/auth/google", json={"credential": "new"}).status_code == 400
        challenge = browser.post("/api/auth/google/challenge")
        nonce = challenge.json()["nonce"]
        cookie = browser.cookies.get(google_login.NONCE_COOKIE)
        assert nonce == google_login.challenge_nonce(cookie) and nonce != cookie
        assert "HttpOnly" in challenge.headers["set-cookie"] and "SameSite=strict" in challenge.headers["set-cookie"]
        created = browser.post("/api/auth/google", json={"credential": "new"})
        assert created.status_code == 200
        headers = {"Authorization": f"Bearer {created.json()['access_token']}"}
        me = browser.get("/api/auth/me", headers=headers).json()
        assert me["email"] == "google-only@example.com" and me["password_enabled"] is False
        assert "google_subject" not in me
        assert browser.post("/api/auth/password", headers=headers, json={
            "current_password": "any-password", "new_password": "different-password",
        }).status_code == 403
        assert browser.post("/api/auth/google", json={"credential": "new"}).status_code == 400

        credentials = {"email": "existing-google@example.com", "password": "known-password"}
        signup = browser.post("/api/auth/signup", json=credentials).json()
        nonce = browser.post("/api/auth/google/challenge").json()["nonce"]
        assert browser.post("/api/auth/google", json={"credential": "existing"}).json()["detail"] == (
            "google_login_password_required"
        )
        assert browser.post("/api/auth/google", json={
            "credential": "existing", "current_password": "incorrect-password",
        }).status_code == 400
        linked = browser.post("/api/auth/google", json={
            "credential": "existing", "current_password": credentials["password"],
        })
        headers = {"Authorization": f"Bearer {linked.json()['access_token']}"}
        me = browser.get("/api/auth/me", headers=headers).json()
        assert me["id"] == signup["id"] and me["password_enabled"] is True
        nonce = browser.post("/api/auth/google/challenge").json()["nonce"]
        assert browser.post("/api/auth/google", json={"credential": "existing"}).status_code == 200


def test_google_credential_checks_signature_audience_expiry_and_browser_nonce(monkeypatch) -> None:
    from datetime import datetime, timedelta, timezone

    import jwt
    from cryptography.hazmat.primitives.asymmetric import rsa

    from app.services import google_login

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    monkeypatch.setattr(google_login.GOOGLE_KEYS, "get_signing_key_from_jwt", lambda _: SimpleNamespace(key=key.public_key()))
    now = datetime.now(timezone.utc)
    aud = "test.apps.googleusercontent.com"
    nonce = google_login.challenge_nonce("test-only-cookie")
    claims = {
        "aud": aud, "iss": "https://accounts.google.com", "exp": now + timedelta(minutes=5),
        "iat": now, "sub": "unique-test-subject", "nonce": nonce,
        "email": "verified@example.com", "email_verified": True,
    }
    token = jwt.encode(claims, key, algorithm="RS256")
    assert google_login.verify_credential(token, aud, nonce) == ("unique-test-subject", "verified@example.com", None)
    for invalid in [
        {"aud": "different-client"},
        {"iss": "https://example.com"},
        {"nonce": "different-browser"},
        {"exp": now - timedelta(minutes=2)},
        {"email_verified": False},
    ]:
        token = jwt.encode({**claims, **invalid}, key, algorithm="RS256")
        with pytest.raises(jwt.InvalidTokenError):
            google_login.verify_credential(token, aud, nonce)
    with pytest.raises(jwt.InvalidTokenError):
        altered = jwt.encode(claims, "test-only-symmetric-key-for-negative-check", algorithm="HS256")
        google_login.verify_credential(altered, aud, nonce)


def test_password_recovery_restricts_session_and_consumes_credential(monkeypatch):
    from uuid import UUID

    from app.core.security import verify_password
    from app.models.user import User
    from app.services import password_recovery

    outbox = []
    monkeypatch.setattr(password_recovery, "mail_configured", lambda: True)
    monkeypatch.setattr(password_recovery, "allow_request", lambda _address: True)
    monkeypatch.setattr(password_recovery, "get_session_factory", lambda: TestingSession)
    monkeypatch.setattr(password_recovery, "send_email", lambda email, secret: outbox.append((email, secret)))

    email = "recover-me@example.com"
    original = "original-password"
    replacement = "replacement-password"
    signup = client.post("/api/auth/signup", json={"email": email, "password": original})
    user_id = UUID(signup.json()["id"])

    def login(password):
        return client.post("/api/auth/login", json={"email": email, "password": password})

    def bearer(response):
        return {"Authorization": "Bearer " + response.json()["access_token"]}

    old_session = bearer(login(original))
    unknown = client.post("/api/auth/password-recovery", json={"email": "unknown@example.com"})
    issued = client.post("/api/auth/password-recovery", json={"email": email.upper()})
    repeated = client.post("/api/auth/password-recovery", json={"email": email})
    assert unknown.status_code == issued.status_code == repeated.status_code == 202
    assert unknown.json() == issued.json() == repeated.json() == {"accepted": True}
    assert len(outbox) == 1 and outbox[0][0] == email
    temporary = outbox[0][1]
    with TestingSession() as db:
        user = db.get(User, user_id)
        assert user.recovery_password_hash.startswith("$argon2id$")
        assert temporary not in user.recovery_password_hash
        assert verify_password(original, user.password_hash)

    limited = bearer(login(temporary))
    me = client.get("/api/auth/me", headers=limited)
    assert me.json()["password_change_required"] is True
    assert "recovery_password_hash" not in me.json()
    assert client.get("/api/scheduling/tasks", headers=limited).status_code == 403
    assert client.patch("/api/auth/time-zone", headers=limited, json={"time_zone": "UTC"}).status_code == 403
    assert client.get("/api/auth/me", headers=old_session).json()["password_change_required"] is False

    invalid = client.post("/api/auth/password", headers=limited,
                          json={"current_password": temporary, "new_password": "a" * 129})
    assert invalid.status_code == 422
    assert temporary not in invalid.text and "input" not in invalid.text

    wrong = client.post("/api/auth/password", headers=limited,
                        json={"current_password": original, "new_password": replacement})
    assert wrong.status_code == 400
    changed = client.post("/api/auth/password", headers=limited,
                          json={"current_password": temporary, "new_password": replacement})
    assert changed.status_code == 200
    assert client.get("/api/scheduling/tasks", headers=bearer(changed)).status_code == 200
    assert client.get("/api/auth/me", headers=limited).status_code == 401
    assert client.get("/api/auth/me", headers=old_session).status_code == 401
    assert login(temporary).status_code == login(original).status_code == 401
    assert login(replacement).status_code == 200
    with TestingSession() as db:
        user = db.get(User, user_id)
        assert user.recovery_password_hash is None and user.recovery_expires_at is None
        assert user.password_hash.startswith("$argon2id$")


def test_password_recovery_expiry_and_google_only_account(monkeypatch):
    from datetime import datetime, timedelta, timezone
    from uuid import UUID

    from app.core.security import hash_password
    from app.models.user import User
    from app.services import password_recovery

    monkeypatch.setattr(password_recovery, "mail_configured", lambda: True)
    monkeypatch.setattr(password_recovery, "allow_request", lambda _address: True)
    monkeypatch.setattr(password_recovery, "get_session_factory", lambda: TestingSession)
    outbox = []
    monkeypatch.setattr(password_recovery, "send_email", lambda *args: outbox.append(args))
    email = "expired-recovery@example.com"
    signup = client.post("/api/auth/signup", json={"email": email, "password": "original-password"})
    user_id = UUID(signup.json()["id"])
    secret = "expired-test-credential"
    with TestingSession() as db:
        user = db.get(User, user_id)
        user.recovery_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        user.recovery_password_hash = hash_password(secret)
        db.commit()
    assert client.post("/api/auth/login", json={"email": email, "password": secret}).status_code == 401
    with TestingSession() as db:
        user = db.get(User, user_id)
        user.password_enabled = False
        db.commit()
    assert client.post("/api/auth/password-recovery", json={"email": email}).status_code == 202
    assert not outbox


def test_password_recovery_disabled_without_mail(monkeypatch):
    monkeypatch.setattr("app.services.password_recovery.mail_configured", lambda: False)
    response = client.post("/api/auth/password-recovery", json={"email": "mail@example.com"})
    assert response.status_code == 503
    assert response.json() == {"detail": "password_recovery_unavailable"}
