"""Password hashing and access-token helpers."""

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


def create_access_token(subject: str) -> str:
    """Create a signed, expiring access token for a user ID."""
    settings = get_settings()

    expires_at = datetime.now(timezone.utc) + timedelta(
        minutes=settings.jwt_access_token_expire_minutes,
    )
    return jwt.encode(
        {"sub": subject, "exp": expires_at},
        get_jwt_secret(),
        algorithm=settings.jwt_algorithm,
    )


def decode_access_token(token: str) -> str:
    """Validate an access token and return its subject."""
    settings = get_settings()

    payload = jwt.decode(
        token,
        get_jwt_secret(),
        algorithms=[settings.jwt_algorithm],
    )
    subject = payload.get("sub")
    if not isinstance(subject, str) or not subject:
        raise jwt.InvalidTokenError("Token subject is missing")
    return subject
