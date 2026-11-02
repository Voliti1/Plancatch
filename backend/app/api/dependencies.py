"""Shared API dependencies."""

import uuid
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.security import decode_access_claims, verify_access_password
from app.db.session import get_db
from app.models.user import User

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


def get_authenticated_user(
    credentials: BearerCredentials,
    db: DatabaseSession,
) -> User:
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
    try:
        verify_access_password(claims, user.password_hash)
    except jwt.InvalidTokenError:
        raise unauthorized() from None
    return user


CurrentUser = Annotated[User, Depends(get_authenticated_user)]
