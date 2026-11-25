"""Validate Google Identity Services credentials against this application's client."""

from hashlib import sha256
from hmac import compare_digest

import jwt
from pydantic import EmailStr, TypeAdapter, ValidationError

GOOGLE_KEYS = jwt.PyJWKClient("https://www.googleapis.com/oauth2/v3/certs", timeout=5)
GOOGLE_ISSUERS = ("https://accounts.google.com", "accounts.google.com")
NONCE_COOKIE = "plancatch_google_login"
NONCE_PATH = "/api/auth/google"
NONCE_TTL = 600
email_adapter = TypeAdapter(EmailStr)


def challenge_nonce(browser_secret: str) -> str:
    """Expose only a hash of the browser secret in the provider token."""
    return sha256(browser_secret.encode()).hexdigest()


def verify_credential(credential: str, client_id: str, nonce: str) -> tuple[str, str, str | None]:
    """Return the verified account identifier, email and optional name."""
    key = GOOGLE_KEYS.get_signing_key_from_jwt(credential)
    claims = jwt.decode(
        credential,
        key.key,
        algorithms=["RS256"],
        audience=client_id,
        issuer=GOOGLE_ISSUERS,
        options={"require": ["aud", "iss", "exp", "iat", "sub", "nonce"]},
        leeway=15,
    )
    actual_nonce = claims["nonce"]
    subject = claims["sub"]
    if (
        not isinstance(actual_nonce, str) or not actual_nonce.isascii()
        or not compare_digest(actual_nonce, nonce)
        or not isinstance(subject, str) or not 0 < len(subject) <= 255
        or claims.get("azp", client_id) != client_id
        or claims.get("email_verified") is not True
    ):
        raise jwt.InvalidTokenError("Invalid Google login claims")
    try:
        email = email_adapter.validate_python(claims.get("email")).strip().lower()
    except ValidationError as exc:
        raise jwt.InvalidTokenError("Invalid Google email address") from exc
    if len(email) > 320:
        raise jwt.InvalidTokenError("Invalid Google email address")
    name = claims.get("name")
    return subject, email, (name.strip()[:100] or None if isinstance(name, str) else None)
