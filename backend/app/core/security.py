"""Password hashing and access-token helpers."""

import hashlib
import hmac
from datetime import datetime, timedelta, timezone

import jwt
from pwdlib import PasswordHash

from app.core.config import get_settings

password_hash = PasswordHash.recommended()
DUMMY_PASSWORD_HASH = password_hash.hash("not-a-real-user-password")


def get_jwt_secret() -> str:
    """Return a signing key that is long enough for HS256."""
    secret = get_settings().jwt_secret_key
    if secret is None:
        raise RuntimeError("JWT_SECRET_KEY is not configured")

    secret_value = secret.get_secret_value()
    if len(secret_value.encode()) < 32:
        raise RuntimeError("JWT_SECRET_KEY must be at least 32 bytes")
    return secret_value


def hash_password(password: str) -> str:
    """Return a secure Argon2 hash for a plaintext password."""
    return password_hash.hash(password)


def verify_password(password: str, hashed_password: str) -> bool:
    """Check a plaintext password against its stored hash."""
    return password_hash.verify(password, hashed_password)


def password_stamp(hashed_password: str) -> str:
    """Bind new sessions to the password hash without exposing the hash in JWTs."""
    return hmac.new(get_jwt_secret().encode(), hashed_password.encode(), hashlib.sha256).hexdigest()


def create_access_token(subject: str, hashed_password: str | None = None) -> str:
    """Create a signed, expiring access token for a user ID."""
    settings = get_settings()

    expires_at = datetime.now(timezone.utc) + timedelta(
        minutes=settings.jwt_access_token_expire_minutes,
    )
    payload = {"sub": subject, "exp": expires_at}
    if hashed_password is not None:
        payload["pwd"] = password_stamp(hashed_password)
    return jwt.encode(
        payload,
        get_jwt_secret(),
        algorithm=settings.jwt_algorithm,
    )


def decode_access_token(token: str, hashed_password: str | None = None) -> str:
    """Validate an access token and return its subject."""
    settings = get_settings()

    payload = jwt.decode(
        token,
        get_jwt_secret(),
        algorithms=[settings.jwt_algorithm],
        options={"require": ["exp", "sub"]},
    )
    subject = payload.get("sub")
    if not isinstance(subject, str) or not subject:
        raise jwt.InvalidTokenError("Token subject is missing")
    # Existing sessions created before password binding retain their original expiry.
    # New logins and password changes are bound and revoke on the next password change.
    if hashed_password is not None and "pwd" in payload:
        stamp = payload["pwd"]
        if not isinstance(stamp, str) or not hmac.compare_digest(stamp, password_stamp(hashed_password)):
            raise jwt.InvalidTokenError("Password changed")
    return subject
