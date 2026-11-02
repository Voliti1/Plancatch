"""Bounded, fixed-endpoint OAuth client and user-bound encrypted token envelopes.

No calendar reads/writes in this connection-only feature. Provider responses,
authorization codes, client secrets and tokens must never be logged or returned.
"""

import base64
import hashlib
import json
import logging
import re
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from ipaddress import ip_address
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import get_settings

PREFIX = "/api/integrations/google-calendar"
CALLBACK_PATH = PREFIX + "/callback"
SCOPE = "https://www.googleapis.com/auth/calendar.events.owned"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
COOKIE = "plancatch_google_oauth"
TTL_SECONDS = 600
MAX_RESPONSE = 65536


class CalendarConfigurationError(Exception):
    """Configuration unavailable; never include setting values in this error."""


class CalendarProviderError(Exception):
    """Sanitized public error code, never a raw provider response."""

    def __init__(self, code="provider_error"):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class CalendarConfig:
    client_id: str
    client_secret: str = field(repr=False)
    redirect_uri: str
    cipher: Fernet = field(repr=False)
    secure_cookie: bool


def configuration() -> CalendarConfig:
    settings = get_settings()
    try:
        if (
            settings.google_client_secret is None
            or settings.google_calendar_token_key is None
        ):
            raise ValueError
        client = settings.google_client_id or ""
        secret = settings.google_client_secret.get_secret_value()
        redirect = settings.google_calendar_redirect_uri or ""
        key = settings.google_calendar_token_key.get_secret_value()
        parsed = urlsplit(redirect)
        if not re.fullmatch(
            r"[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com", client
        ):
            raise ValueError
        if not secret.strip() or len(secret) > 1024 or any(c.isspace() for c in secret):
            raise ValueError
        if (
            parsed.path != CALLBACK_PATH
            or parsed.query
            or parsed.fragment
            or parsed.username
            or parsed.password
        ):
            raise ValueError
        if not parsed.hostname or parsed.port not in (None, 443, 8000):
            raise ValueError
        local = parsed.hostname in {"localhost", "127.0.0.1"}
        if local:
            if parsed.scheme != "http" or settings.app_env not in {
                "development",
                "test",
            }:
                raise ValueError
        else:
            if parsed.scheme != "https" or parsed.port not in (None, 443):
                raise ValueError
            try:
                ip_address(parsed.hostname)
            except ValueError:
                pass
            else:
                raise ValueError
        return CalendarConfig(
            client, secret, redirect, Fernet(key.encode("ascii")), not local
        )
    except (AttributeError, TypeError, ValueError, UnicodeError):
        raise CalendarConfigurationError(
            "Google Calendar configuration unavailable"
        ) from None


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def encrypt(config: CalendarConfig, user_id: uuid.UUID, kind: str, value: str) -> str:
    envelope = json.dumps(
        {
            "user_id": str(user_id),
            "client_id": config.client_id,
            "kind": kind,
            "value": value,
        }
    )
    return config.cipher.encrypt(envelope.encode()).decode()


def decrypt(config: CalendarConfig, user_id: uuid.UUID, kind: str, value: str) -> str:
    try:
        envelope = json.loads(config.cipher.decrypt(value.encode()))
        if (
            envelope["user_id"] != str(user_id)
            or envelope["kind"] != kind
            or envelope["client_id"] != config.client_id
        ):
            raise ValueError
        token = envelope["value"]
        if not isinstance(token, str) or not token:
            raise ValueError
        return token
    except (
        InvalidToken,
        ValueError,
        TypeError,
        KeyError,
        AttributeError,
        UnicodeError,
    ):
        raise CalendarProviderError("credentials_unavailable") from None


def authorization_url(config: CalendarConfig, state: str, verifier: str) -> str:
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
        .rstrip(b"=")
        .decode()
    )
    return "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(
        {
            "client_id": config.client_id,
            "redirect_uri": config.redirect_uri,
            "response_type": "code",
            "scope": SCOPE,
            "state": state,
            "access_type": "offline",
            "prompt": "consent select_account",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
    )


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _post(url: str, data: dict) -> tuple[int, dict]:
    if url not in {TOKEN_URL, REVOKE_URL}:
        raise CalendarProviderError()
    request = Request(
        url,
        data=urlencode(data).encode(),
        headers={
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    try:
        try:
            with build_opener(NoRedirect()).open(request, timeout=10) as response:
                status, raw = response.status, response.read(MAX_RESPONSE + 1)
        except HTTPError as error:
            status, raw = error.code, error.read(MAX_RESPONSE + 1)
        if len(raw) > MAX_RESPONSE:
            raise ValueError
        payload = json.loads(raw) if raw else {}
        if not isinstance(payload, dict):
            raise TypeError
        return status, payload
    except (URLError, TimeoutError, OSError, ValueError, TypeError, UnicodeError):
        raise CalendarProviderError() from None


def exchange_code(
    config: CalendarConfig, code: str, verifier: str
) -> tuple[str, str, datetime | None]:
    status, payload = _post(
        TOKEN_URL,
        {
            "client_id": config.client_id,
            "client_secret": config.client_secret,
            "redirect_uri": config.redirect_uri,
            "code": code,
            "code_verifier": verifier,
            "grant_type": "authorization_code",
        },
    )
    if status != 200:
        # Do not disclose Google's error_description or raw body.
        raise CalendarProviderError()
    scopes = payload.get("scope", "")
    refresh = payload.get("refresh_token")
    if not isinstance(scopes, str) or SCOPE not in scopes.split():
        raise CalendarProviderError("insufficient_scope")
    if not isinstance(refresh, str) or not refresh or len(refresh) > 16384:
        # Never reuse a previous account's token if Google omits a new refresh token.
        raise CalendarProviderError("refresh_token_missing")
    if (
        str(payload.get("token_type", "")).lower() != "bearer"
        or not isinstance(payload.get("access_token"), str)
        or not payload["access_token"]
    ):
        raise CalendarProviderError()
    refresh_expiry = None
    seconds = payload.get("refresh_token_expires_in")
    if seconds is not None:
        if type(seconds) is not int or not 0 < seconds <= 315360000:
            raise CalendarProviderError()
        refresh_expiry = datetime.now(UTC) + timedelta(seconds=seconds)
    return refresh, " ".join(sorted(set(scopes.split()))), refresh_expiry


def revoke_token(refresh_token: str) -> bool:
    try:
        status, payload = _post(REVOKE_URL, {"token": refresh_token})
        return status == 200 or (
            status == 400 and payload.get("error") == "invalid_token"
        )
    except CalendarProviderError:
        return False


class CallbackLogFilter(logging.Filter):
    def filter(self, record):
        args = record.args
        if isinstance(args, tuple) and len(args) == 5 and isinstance(args[2], str):
            path = unquote(args[2].split("?", 1)[0])
            if path == CALLBACK_PATH:
                record.args = (*args[:2], CALLBACK_PATH + "?[redacted]", *args[3:])
        return True


def install_callback_log_filter():
    logger = logging.getLogger("uvicorn.access")
    if not any(isinstance(item, CallbackLogFilter) for item in logger.filters):
        logger.addFilter(CallbackLogFilter())
