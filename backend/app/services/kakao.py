"""Kakao's fixed OAuth and Talk Calendar endpoints."""

import json
import re
from dataclasses import dataclass, field
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, build_opener

from cryptography.fernet import Fernet
from email_validator import EmailNotValidError, validate_email

from app.core.config import get_settings
from app.services.google_calendar import NoRedirect

AUTHORIZE = "https://kauth.kakao.com/oauth/authorize"
TOKEN = "https://kauth.kakao.com/oauth/token"
PROFILE = "https://kapi.kakao.com/v2/user/me"
CALENDARS = "https://kapi.kakao.com/v2/api/calendar/calendars?filter=USER"


class ProviderError(Exception):
    """Keep OAuth responses and provider credentials out of public errors."""


@dataclass(frozen=True)
class Configuration:
    key: str
    secret: str = field(repr=False)
    redirect_uri: str
    secure: bool
    calendar_cipher: Fernet | None = field(default=None, repr=False)


def configuration() -> Configuration | None:
    s = get_settings()
    key = getattr(s, "kakao_rest_api_key", None) or ""
    secret = getattr(s, "kakao_client_secret", None)
    url = getattr(s, "kakao_redirect_uri", None) or ""
    if not re.fullmatch(r"[a-zA-Z0-9]{16,128}", key) or not secret or not secret.get_secret_value():
        return None
    try:
        parsed = urlsplit(url)
        if parsed.path != "/auth/kakao" or not parsed.hostname or any(
            (parsed.username, parsed.password, parsed.query, parsed.fragment)
        ):
            return None
        local = parsed.hostname in {"localhost", "127.0.0.1"}
        if parsed.scheme != ("http" if local else "https") or (local and s.app_env not in {"development", "test"}):
            return None
        cipher_key = getattr(s, "kakao_calendar_token_key", None)
        cipher = Fernet(cipher_key.get_secret_value()) if cipher_key else None
    except (ValueError, TypeError, UnicodeError):
        return None
    return Configuration(key, secret.get_secret_value(), url, not local, cipher)


def request_json(url: str, data=None, access=None) -> dict:
    headers = {"Accept": "application/json"}
    if access:
        headers["Authorization"] = f"Bearer {access}"
    body = urlencode(data).encode("ascii") if data else None
    if body:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    try:
        with build_opener(NoRedirect()).open(Request(url, data=body, headers=headers), timeout=8) as response:
            raw = response.read(131073)
            parsed = json.loads(raw) if len(raw) <= 131072 else None
        if not isinstance(parsed, dict):
            raise TypeError
    except (OSError, ValueError, TypeError):
        raise ProviderError from None
    return parsed


def exchange(config: Configuration, data: dict) -> dict:
    token = request_json(TOKEN, {"client_id": config.key, "client_secret": config.secret, **data})
    access = token.get("access_token")
    if not isinstance(access, str) or not access or not access.isascii() or not access.isprintable():
        raise ProviderError
    return token


def identity(access: str) -> tuple[str, str | None]:
    profile = request_json(PROFILE, access=access)
    identifier = profile.get("id")
    if type(identifier) is not int or not 0 < identifier < 10**30:
        raise ProviderError
    account = profile.get("kakao_account")
    if not isinstance(account, dict) or account.get("is_email_valid") is not True or account.get("is_email_verified") is not True:
        return str(identifier), None
    try:
        email = validate_email(account.get("email", ""), check_deliverability=False).normalized
    except (EmailNotValidError, TypeError):
        email = None
    return str(identifier), email.lower() if email else None


def calendar_names(access: str) -> list[dict[str, str]]:
    entries = request_json(CALENDARS, access=access).get("calendars")
    if not isinstance(entries, list):
        raise ProviderError
    return [
        {"id": row["id"], "name": (row.get("name") or ("기본 캘린더" if row["id"] == "primary" else "서브 캘린더"))[:100]}
        for row in entries[:100]
        if isinstance(row, dict) and isinstance(row.get("id"), str) and isinstance(row.get("name", ""), str)
    ]


def seal(config, user_id, token):
    return config.calendar_cipher.encrypt(json.dumps({"user": str(user_id), "token": token}).encode()).decode()


def unseal(config, user_id, value):
    payload = json.loads(config.calendar_cipher.decrypt(value))
    if payload["user"] != str(user_id):
        raise ProviderError
    return payload["token"]
