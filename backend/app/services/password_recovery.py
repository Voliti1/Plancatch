"""Issue temporary authentication credentials and deliver them by email."""

import json
from base64 import urlsafe_b64encode
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from logging import getLogger
from secrets import token_urlsafe
from smtplib import SMTP, SMTP_SSL
from ssl import create_default_context
from threading import Lock
from time import monotonic
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import Settings, get_settings
from app.core.security import hash_password
from app.db.session import get_session_factory
from app.models.user import User

RECOVERY_LIFETIME = timedelta(minutes=15)
RESEND_COOLDOWN = timedelta(minutes=5)
_logger = getLogger(__name__)
_requests: OrderedDict[str, tuple[float, int]] = OrderedDict()
_request_lock = Lock()


def utc(value: datetime) -> datetime:
    # SQLite returns naive datetimes from timezone-aware columns.
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def active_recovery_hash(user: User) -> str | None:
    expires = user.recovery_expires_at
    if user.password_enabled and expires and utc(expires) > datetime.now(timezone.utc):
        return user.recovery_password_hash
    return None


def gmail_configured(settings: Settings) -> bool:
    return bool(settings.recovery_gmail_client_id and settings.recovery_gmail_client_secret
                and settings.recovery_gmail_refresh_token)


def mail_configured() -> bool:
    settings = get_settings()
    return bool(settings.recovery_from_email and (
        gmail_configured(settings) or (
            settings.recovery_smtp_host and settings.recovery_smtp_username and settings.recovery_smtp_password
        )
    ))


def allow_request(address: str) -> bool:
    now = monotonic()
    with _request_lock:
        while _requests and next(iter(_requests.values()))[0] <= now:
            _requests.popitem(last=False)
        if address not in _requests and len(_requests) >= 4096:
            return False
        deadline, count = _requests.get(address, (now + 300, 0))
        if count >= 10:
            return False
        _requests[address] = (deadline, count + 1)
        return True


def send_gmail(settings: Settings, message: EmailMessage) -> None:
    token_request = Request(
        "https://oauth2.googleapis.com/token",
        data=urlencode({
            "grant_type": "refresh_token",
            "client_id": settings.recovery_gmail_client_id,
            "client_secret": settings.recovery_gmail_client_secret.get_secret_value(),
            "refresh_token": settings.recovery_gmail_refresh_token.get_secret_value(),
        }).encode("ascii"),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urlopen(token_request, timeout=8) as response:
        token = json.load(response).get("access_token")
    if not isinstance(token, str) or not token or not token.isascii() or not token.isprintable():
        raise ValueError("Invalid Gmail access token response")

    send_request = Request(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        data=json.dumps({"raw": urlsafe_b64encode(message.as_bytes()).decode("ascii")}).encode("ascii"),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    with urlopen(send_request, timeout=8) as response:
        if response.status != 200:
            raise OSError("Gmail did not accept the message")


def send_email(recipient: str, temporary_password: str) -> None:
    settings = get_settings()
    message = EmailMessage()
    message["From"] = settings.recovery_from_email
    message["To"] = recipient
    message["Subject"] = "[PlanCatch] 임시 비밀번호"
    message.set_content(
        "아래 임시 비밀번호로 PlanCatch에 로그인한 뒤 새 비밀번호를 설정해 주세요.\n\n"
        f"{temporary_password}\n\n"
        "임시 비밀번호는 발급 후 15분 동안 유효합니다. "
        "직접 요청하지 않았다면 이 메일을 무시해 주세요."
    )
    if gmail_configured(settings):
        send_gmail(settings, message)
        return
    context = create_default_context()
    server = (
        SMTP_SSL(settings.recovery_smtp_host, settings.recovery_smtp_port, timeout=8, context=context)
        if settings.recovery_smtp_implicit_tls
        else SMTP(settings.recovery_smtp_host, settings.recovery_smtp_port, timeout=8)
    )
    with server:
        if not settings.recovery_smtp_implicit_tls:
            server.starttls(context=context)
        server.login(settings.recovery_smtp_username, settings.recovery_smtp_password.get_secret_value())
        server.send_message(message)


def issue_and_send(email: str) -> None:
    try:
        with get_session_factory()() as db:
            user = db.scalar(select(User).where(User.email == email).with_for_update())
            if user is None or not user.password_enabled or not user.is_active:
                return
            now = datetime.now(timezone.utc)
            previous_expiry = user.recovery_expires_at
            if previous_expiry and utc(previous_expiry) > now + RECOVERY_LIFETIME - RESEND_COOLDOWN:
                return
            temporary_password = token_urlsafe(24)
            user.recovery_password_hash = hash_password(temporary_password)
            user.recovery_expires_at = now + RECOVERY_LIFETIME
            db.commit()
        send_email(email, temporary_password)
    except (OSError, SQLAlchemyError, ValueError, RuntimeError):
        # Mail provider replies and database exceptions can include sensitive parameters.
        _logger.warning("Password recovery issuance or delivery failed")
