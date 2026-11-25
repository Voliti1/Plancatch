"""Shared API dependencies."""

import uuid
from dataclasses import dataclass
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.security import decode_access_claims, verify_access_password
from app.db.session import get_db
from app.models.user import User
from app.services.password_recovery import active_recovery_hash

DatabaseSession = Annotated[Session, Depends(get_db)]
bearer_scheme = HTTPBearer(auto_error=False)
BearerCredentials = Annotated[
    HTTPAuthorizationCredentials | None,
    Depends(bearer_scheme),
]


def unauthorized() -> HTTPException:
    """Return the standard response for failed authentication."""
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid authentication credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


@dataclass
class AuthenticatedSession:
    user: User
    claims: dict

    @property
    def recovery(self) -> bool:
        return self.claims.get("purpose") == "password_recovery"


def get_authenticated_session(
    credentials: BearerCredentials,
    db: DatabaseSession,
) -> AuthenticatedSession:
    """Resolve a valid bearer token to an active user."""
    if credentials is None:
        raise unauthorized()

    try:
        claims = decode_access_claims(credentials.credentials)
        user_id = uuid.UUID(claims["sub"])
    except (jwt.InvalidTokenError, ValueError):
        raise unauthorized() from None

    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise unauthorized()
    session = AuthenticatedSession(user, claims)
    if session.recovery:
        candidate_hash = active_recovery_hash(user)
        if candidate_hash is None or "pwd" not in claims:
            raise unauthorized()
    elif "purpose" in claims:
        raise unauthorized()
    else:
        candidate_hash = user.password_hash
    try:
        verify_access_password(claims, candidate_hash)
    except jwt.InvalidTokenError:
        raise unauthorized() from None
    return session


AuthSession = Annotated[AuthenticatedSession, Depends(get_authenticated_session)]


def get_authenticated_user(session: AuthSession) -> User:
    if session.recovery:
        raise HTTPException(403, "password_change_required")
    return session.user


CurrentUser = Annotated[User, Depends(get_authenticated_user)]
