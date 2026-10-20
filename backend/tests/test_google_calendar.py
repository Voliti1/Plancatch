"""Connection contract/security checks. All Google HTTP calls are simulated."""

import base64
import hashlib
import logging
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from urllib.error import URLError
from urllib.parse import parse_qs, urlsplit

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.main import app
from app.models.google_calendar import GoogleCalendarConnection, GoogleOAuthRequest
from app.models.user import User
from app.services import google_calendar as google
from tests.test_auth import TestingSession
from tests.test_sources import auth_headers, configure_test_jwt  # noqa: F401

BASE = google.PREFIX
REAL_EXCHANGE = google.exchange_code


@pytest.fixture
def setup(monkeypatch):
    settings = SimpleNamespace(
        app_env="test",
        google_client_id="123456-test.apps.googleusercontent.com",
        google_client_secret=SecretStr("fake-google-secret-not-real"),
        google_calendar_redirect_uri="http://localhost:8000" + google.CALLBACK_PATH,
        google_calendar_token_key=SecretStr(Fernet.generate_key().decode()),
    )
    calls, revoked = [], []

    def exchange(config, code, verifier):
        calls.append((code, verifier))
        return "fake-refresh-" + code, google.SCOPE, None

    def revoke(token):
        revoked.append(token)
        return True

    monkeypatch.setattr(google, "get_settings", lambda: settings)
    monkeypatch.setattr(google, "exchange_code", exchange)
    monkeypatch.setattr(google, "revoke_token", revoke)
    with TestClient(app, base_url="http://localhost:8000") as client:
        yield SimpleNamespace(
            settings=settings, client=client, calls=calls, revoked=revoked
        )


def owner():
    return auth_headers(f"google-{uuid.uuid4().hex}@example.com")


def start(setup, auth=None):
    auth = auth or owner()
    response = setup.client.post(BASE + "/connect", headers=auth)
    assert response.status_code == 200
    query = parse_qs(urlsplit(response.json()["authorization_url"]).query)
    return auth, query["state"][0], query


def callback(setup, state, code="test-code", extra=None):
    return setup.client.get(
        google.CALLBACK_PATH,
        params={"state": state, "code": code, **(extra or {})},
        follow_redirects=False,
    )


def connection_user(auth):
    # Authentication already validates this token. The test reads its public sub
    # through the application's normal authenticated endpoint, never real data.
    from tests.test_auth import client

    return uuid.UUID(client.get("/api/auth/me", headers=auth).json()["id"])


@pytest.mark.parametrize(
    "method,path", [("get", "/status"), ("post", "/connect"), ("delete", "/connection")]
)
def test_connection_requires_plancatch_login(setup, method, path):
    assert getattr(setup.client, method)(BASE + path).status_code == 401
    assert setup.calls == []


def test_missing_settings_fail_closed_without_returning_secret(setup):
    setup.settings.google_calendar_token_key = None
    auth = owner()
    status = setup.client.get(BASE + "/status", headers=auth)
    assert status.status_code == 200 and status.json()["configured"] is False
    response = setup.client.post(BASE + "/connect", headers=auth)
    assert response.status_code == 503
    assert "fake-google" not in response.text
    assert "set-cookie" not in response.headers


def test_pkce_cookie_and_persisted_state_are_not_plaintext(setup):
    auth, state, query = start(setup)
    assert query["scope"] == [google.SCOPE]
    assert query["access_type"] == ["offline"]
    assert query["code_challenge_method"] == ["S256"]
    assert query["prompt"] == ["consent select_account"]
    assert query["redirect_uri"] == [setup.settings.google_calendar_redirect_uri]
    with TestingSession() as db:
        row = db.get(GoogleOAuthRequest, google.digest(state))
        assert row is not None and not row.consumed
        assert row.user_id == connection_user(auth)
        verifier = google.decrypt(
            google.configuration(), row.user_id, "pkce", row.verifier_ciphertext
        )
        expected = (
            base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
            .rstrip(b"=")
            .decode()
        )
        assert query["code_challenge"] == [expected]
        assert row.state_hash != state and verifier not in row.verifier_ciphertext
        assert row.browser_hash != setup.client.cookies.get(google.COOKIE)
    status = setup.client.get(BASE + "/status", headers=auth)
    assert status.json()["pending"] and not status.json()["connected"]


def test_callback_saves_only_owner_bound_encrypted_refresh_token(setup):
    auth, state, _ = start(setup)
    response = callback(setup, state)
    assert response.status_code == 303 and response.headers["location"].endswith(
        "result=connected"
    )
    assert response.headers["cache-control"] == "no-store"
    assert "HttpOnly" in response.headers["set-cookie"]
    user_id = connection_user(auth)
    with TestingSession() as db:
        row = db.get(GoogleCalendarConnection, user_id)
        assert row is not None and "fake-refresh" not in row.refresh_token_ciphertext
        assert (
            google.decrypt(
                google.configuration(), user_id, "refresh", row.refresh_token_ciphertext
            )
            == "fake-refresh-test-code"
        )
        assert db.get(GoogleOAuthRequest, google.digest(state)) is None
        with pytest.raises(google.CalendarProviderError):
            google.decrypt(
                google.configuration(),
                uuid.uuid4(),
                "refresh",
                row.refresh_token_ciphertext,
            )
        with pytest.raises(google.CalendarProviderError):
            google.decrypt(
                google.configuration(), user_id, "pkce", row.refresh_token_ciphertext
            )
    status = setup.client.get(BASE + "/status", headers=auth)
    assert status.json()["connected"] and not status.json()["pending"]
    assert "token" not in status.text and "ciphertext" not in status.text
    assert "fake-refresh" not in response.text
    assert callback(setup, state).status_code == 400
    assert len(setup.calls) == 1


@pytest.mark.parametrize(
    "fault", ["no-cookie", "wrong-cookie", "wrong-state", "expired", "consumed"]
)
def test_bad_expired_and_reused_requests_never_call_google(setup, fault):
    auth, state, _ = start(setup)
    if fault == "no-cookie":
        setup.client.cookies.clear()
    elif fault == "wrong-cookie":
        setup.client.cookies.clear()
        setup.client.cookies.set(google.COOKIE, "x" * 43)
    elif fault == "wrong-state":
        state = "x" * 43
    else:
        with TestingSession() as db:
            row = db.get(GoogleOAuthRequest, google.digest(state))
            if fault == "expired":
                row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
            else:
                row.consumed = True
            db.commit()
    assert callback(setup, state).status_code == 400
    assert setup.calls == []
    assert not setup.client.get(BASE + "/status", headers=auth).json()["connected"]


def test_another_browsers_cookie_cannot_finish_owner_request(setup):
    _, first, _ = start(setup)
    start(setup)  # Another owner and cookie in the same test client.
    assert callback(setup, first).status_code == 400
    assert setup.calls == []


@pytest.mark.parametrize("duplicate", ["state", "code", "error"])
def test_duplicate_parameters_do_not_echo_codes(setup, duplicate):
    _, state, _ = start(setup)
    params = [
        ("state", state),
        ("code", "sensitive-one-use-code"),
        ("error", "denied"),
        (duplicate, "extra"),
    ]
    response = setup.client.get(google.CALLBACK_PATH, params=params)
    assert response.status_code == 400
    assert "sensitive-one-use-code" not in response.text
    assert setup.calls == []


@pytest.mark.parametrize(
    "error_code",
    [
        "provider_error",
        "refresh_token_missing",
        "insufficient_scope",
        "credentials_unavailable",
    ],
)
def test_failed_reconnect_preserves_previous_connection(setup, monkeypatch, error_code):
    auth, state, _ = start(setup)
    assert callback(setup, state).status_code == 303
    with TestingSession() as db:
        original = db.get(
            GoogleCalendarConnection, connection_user(auth)
        ).refresh_token_ciphertext
    _, next_state, _ = start(setup, auth)

    def fail(*_args):
        raise google.CalendarProviderError(error_code)

    monkeypatch.setattr(google, "exchange_code", fail)
    response = callback(setup, next_state)
    assert response.headers["location"].endswith("result=" + error_code)
    with TestingSession() as db:
        assert (
            db.get(
                GoogleCalendarConnection, connection_user(auth)
            ).refresh_token_ciphertext
            == original
        )
        assert db.get(GoogleOAuthRequest, google.digest(next_state)) is None


def test_consent_denial_does_not_call_google(setup):
    auth, state, _ = start(setup)
    response = setup.client.get(
        google.CALLBACK_PATH,
        params={
            "state": state,
            "error": "access_denied",
            "error_description": "must-never-be-displayed",
        },
        follow_redirects=False,
    )
    assert response.status_code == 303 and response.headers["location"].endswith(
        "result=cancelled"
    )
    assert "must-never" not in response.text and setup.calls == []
    assert not setup.client.get(BASE + "/status", headers=auth).json()["pending"]


def test_new_request_invalidates_old_state(setup):
    auth, old, _ = start(setup)
    _, new, _ = start(setup, auth)
    assert old != new and callback(setup, old).status_code == 400
    assert callback(setup, new).headers["location"].endswith("result=connected")


@pytest.mark.parametrize("race", ["disconnect", "new-connect"])
def test_inflight_exchange_cannot_overwrite_disconnection_or_new_request(
    setup, monkeypatch, race
):
    auth, state, _ = start(setup)

    def exchange(*_args):
        with TestClient(app, base_url="http://localhost:8000") as other:
            if race == "disconnect":
                assert (
                    other.delete(BASE + "/connection", headers=auth).status_code == 200
                )
            else:
                assert other.post(BASE + "/connect", headers=auth).status_code == 200
        return "fake-stale-refresh", google.SCOPE, None

    monkeypatch.setattr(google, "exchange_code", exchange)
    response = callback(setup, state)
    assert response.headers["location"].endswith("result=cancelled")
    assert not setup.client.get(BASE + "/status", headers=auth).json()["connected"]


def test_inactive_user_cannot_finalize(setup):
    auth, state, _ = start(setup)
    with TestingSession() as db:
        db.get(User, connection_user(auth)).is_active = False
        db.commit()
    assert callback(setup, state).headers["location"].endswith("result=cancelled")
    assert setup.calls == []


@pytest.mark.parametrize("revoke_success", [True, False])
def test_disconnect_is_owner_scoped_and_clears_even_if_google_fails(
    setup, monkeypatch, revoke_success
):
    auth, state, _ = start(setup)
    callback(setup, state)
    other, second, _ = start(setup)
    callback(setup, second)
    monkeypatch.setattr(google, "revoke_token", lambda _token: revoke_success)
    result = setup.client.delete(BASE + "/connection", headers=auth)
    assert result.json() == {
        "disconnected": True,
        "google_revoked": revoke_success,
        "manual_revoke_required": not revoke_success,
    }
    assert not setup.client.get(BASE + "/status", headers=auth).json()["connected"]
    assert setup.client.get(BASE + "/status", headers=other).json()["connected"]
    repeated = setup.client.delete(BASE + "/connection", headers=auth)
    assert repeated.json()["google_revoked"] is None


def test_lost_key_requires_reconnect_but_still_allows_local_disconnect(setup):
    auth, state, _ = start(setup)
    callback(setup, state)
    setup.settings.google_calendar_token_key = SecretStr(Fernet.generate_key().decode())
    status = setup.client.get(BASE + "/status", headers=auth).json()
    assert status["reconnect_required"] and not status["connected"]
    result = setup.client.delete(BASE + "/connection", headers=auth).json()
    assert result["manual_revoke_required"] and result["disconnected"]
    assert setup.revoked == []


@pytest.mark.parametrize(
    "uri",
    [
        "http://example.com" + google.CALLBACK_PATH,
        "https://16.184.24.84" + google.CALLBACK_PATH,
        "https://user:password@example.com" + google.CALLBACK_PATH,
        "https://example.com" + google.CALLBACK_PATH + "?token=x",
        "https://example.com" + google.CALLBACK_PATH + "#fragment",
        "https://example.com/wrong-path",
        "https://example.com:8000" + google.CALLBACK_PATH,
    ],
)
def test_unsafe_redirect_configuration_is_rejected(setup, uri):
    setup.settings.google_calendar_redirect_uri = uri
    assert setup.client.post(BASE + "/connect", headers=owner()).status_code == 503


def test_http_localhost_is_not_allowed_in_production(setup):
    setup.settings.app_env = "production"
    assert setup.client.post(BASE + "/connect", headers=owner()).status_code == 503


def test_api_origin_must_match_callback_cookie_origin(setup):
    response = setup.client.post(
        "http://127.0.0.1:8000" + BASE + "/connect", headers=owner()
    )
    assert response.status_code == 409 and "set-cookie" not in response.headers


def test_production_cookie_has_required_security_attributes(setup):
    setup.settings.app_env = "production"
    setup.settings.google_calendar_redirect_uri = (
        "https://plancatch.example" + google.CALLBACK_PATH
    )
    response = setup.client.post(
        "https://plancatch.example" + BASE + "/connect", headers=owner()
    )
    assert response.status_code == 200
    cookie = response.headers["set-cookie"]
    assert "Secure" in cookie and "HttpOnly" in cookie and "SameSite=lax" in cookie
    assert "Domain=" not in cookie and "Path=" + google.CALLBACK_PATH in cookie


def test_complete_never_reflects_untrusted_error_text(setup):
    response = setup.client.get(
        BASE + "/complete?result=%3Cscript%3Esecret-code%3C/script%3E"
    )
    assert response.status_code == 200 and "secret-code" not in response.text
    assert response.headers["referrer-policy"] == "no-referrer"


@pytest.mark.parametrize(
    "path",
    [google.CALLBACK_PATH, google.CALLBACK_PATH.replace("callback", "%63allback")],
)
def test_callback_access_log_redacts_query(path):
    record = logging.LogRecord(
        "uvicorn.access",
        logging.INFO,
        "",
        1,
        '%s - "%s %s HTTP/%s" %d',
        (
            "127.0.0.1",
            "GET",
            path + "?code=private-code&state=private-state",
            "1.1",
            303,
        ),
        None,
    )
    assert google.CallbackLogFilter().filter(record)
    assert (
        "private-code" not in record.getMessage()
        and "private-state" not in record.getMessage()
    )
    assert "[redacted]" in record.getMessage()


@pytest.mark.parametrize(
    "fault", ["no-refresh", "no-scope", "bad-type", "provider-failure", "bad-access"]
)
def test_token_exchange_rejects_unusable_responses(setup, monkeypatch, fault):
    # Exercise the saved real validator, still with no Google network requests.
    payload = {
        "refresh_token": "fake-refresh",
        "scope": google.SCOPE,
        "token_type": "Bearer",
        "access_token": "fake-access",
    }
    status = 200
    if fault == "no-refresh":
        payload.pop("refresh_token")
    if fault == "no-scope":
        payload["scope"] = "openid"
    if fault == "bad-type":
        payload["token_type"] = "invalid"
    if fault == "bad-access":
        payload["access_token"] = None
    if fault == "provider-failure":
        status, payload = 400, {"error_description": "private-provider-error"}
    monkeypatch.setattr(google, "_post", lambda *_args: (status, payload))
    with pytest.raises(google.CalendarProviderError) as caught:
        REAL_EXCHANGE(google.configuration(), "private-code", "private-verifier")
    assert "private" not in str(caught.value)


def test_provider_does_not_follow_redirects_or_log_network_errors(monkeypatch):
    assert (
        google.NoRedirect().redirect_request(
            None, None, 302, "", {}, "https://example.com"
        )
        is None
    )

    class Broken:
        def open(self, *args, **kwargs):
            raise URLError("private-provider-message")

    monkeypatch.setattr(google, "build_opener", lambda *_args: Broken())
    with pytest.raises(google.CalendarProviderError) as caught:
        google._post(google.TOKEN_URL, {"client_secret": "fake-secret"})
    assert str(caught.value) == "provider_error"
    with pytest.raises(google.CalendarProviderError):
        google._post("https://example.com", {})


def test_ciphertext_tampering_is_rejected(setup):
    config = google.configuration()
    user = uuid.uuid4()
    token = google.encrypt(config, user, "refresh", "fake-token")
    with pytest.raises(google.CalendarProviderError):
        google.decrypt(config, user, "refresh", token[:-5] + "XXXXX")
    assert "fake-token" not in repr(config)


def test_client_change_requires_reconnection(setup):
    auth, state, _ = start(setup)
    callback(setup, state)
    setup.settings.google_client_id = "123456-new-client.apps.googleusercontent.com"
    result = setup.client.get(BASE + "/status", headers=auth).json()
    assert result["reconnect_required"] and not result["connected"]


def test_known_expired_refresh_token_requires_reconnection(setup):
    auth, state, _ = start(setup)
    callback(setup, state)
    with TestingSession() as db:
        row = db.get(GoogleCalendarConnection, connection_user(auth))
        row.refresh_expires_at = datetime.now(UTC) - timedelta(seconds=1)
        db.commit()
    result = setup.client.get(BASE + "/status", headers=auth).json()
    assert result["reconnect_required"] and not result["connected"]
    assert result["refresh_expires_at"] is not None


@pytest.mark.parametrize("ttl", [False, 0, -1, "60", 315360001])
def test_provider_rejects_invalid_refresh_lifetime(setup, monkeypatch, ttl):
    payload = {
        "refresh_token": "fake-refresh",
        "scope": google.SCOPE,
        "token_type": "Bearer",
        "access_token": "fake-access",
        "refresh_token_expires_in": ttl,
    }
    monkeypatch.setattr(google, "_post", lambda *_args: (200, payload))
    with pytest.raises(google.CalendarProviderError):
        REAL_EXCHANGE(google.configuration(), "fake-code", "fake-verifier")


def test_provider_parses_refresh_lifetime_without_returning_access_token(
    setup, monkeypatch
):
    payload = {
        "refresh_token": "fake-refresh",
        "scope": google.SCOPE,
        "token_type": "Bearer",
        "access_token": "fake-access",
        "refresh_token_expires_in": 3600,
    }
    monkeypatch.setattr(google, "_post", lambda *_args: (200, payload))
    refresh, scopes, expiry = REAL_EXCHANGE(
        google.configuration(), "fake-code", "fake-verifier"
    )
    assert refresh == "fake-refresh" and scopes == google.SCOPE
    assert 3590 < (expiry - datetime.now(UTC)).total_seconds() <= 3600


@pytest.mark.parametrize("raw", [b"[]", b"not-json", b"x" * (google.MAX_RESPONSE + 1)])
def test_provider_rejects_malformed_or_oversized_body(monkeypatch, raw):
    class FakeResponse:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            pass

        def read(self, _size):
            return raw

    class FakeOpener:
        def open(self, *_args, **_kwargs):
            return FakeResponse()

    monkeypatch.setattr(google, "build_opener", lambda *_args: FakeOpener())
    with pytest.raises(google.CalendarProviderError):
        google._post(google.TOKEN_URL, {})

def test_complete_has_fixed_frontend_return_link(setup):
    response = setup.client.get("/api/integrations/google-calendar/complete?result=connected")
    assert response.status_code == 200
    assert 'href="/settings/google-calendar"' in response.text
