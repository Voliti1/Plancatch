"""Authentication endpoints."""

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.dependencies import CurrentUser, DatabaseSession, unauthorized
from app.core.config import get_settings
from app.core.security import (
    DUMMY_PASSWORD_HASH,
    create_access_token,
    hash_password,
    verify_password,
)
from app.models.user import User
from app.schemas.user import (
    PasswordChange,
    TokenResponse,
    UserCreate,
    UserLogin,
    UserResponse,
)

router = APIRouter(prefix="/api/auth", tags=["authentication"])


@router.post(
    "/signup",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
)
def signup(payload: UserCreate, db: DatabaseSession) -> User:
    """Create a user account with a securely hashed password."""
    existing_user = db.scalar(select(User).where(User.email == payload.email))
    if existing_user is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email is already registered",
        )

    user = User(
        email=payload.email,
        password_hash=hash_password(payload.password),
        display_name=payload.display_name,
    )
    db.add(user)

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email is already registered",
        ) from exc

    db.refresh(user)
    return user


@router.post("/login", response_model=TokenResponse)
def login(payload: UserLogin, db: DatabaseSession) -> TokenResponse:
    """Verify account credentials and return a bearer access token."""
    user = db.scalar(select(User).where(User.email == payload.email))
    if user is None:
        verify_password(payload.password, DUMMY_PASSWORD_HASH)
        raise unauthorized()

    if not user.is_active or not verify_password(payload.password, user.password_hash):
        raise unauthorized()

    settings = get_settings()
    return TokenResponse(
        access_token=create_access_token(str(user.id), user.password_hash),
        expires_in=settings.jwt_access_token_expire_minutes * 60,
    )


@router.get("/me", response_model=UserResponse)
def read_current_user(current_user: CurrentUser) -> User:
    """Return the account represented by a valid bearer token."""
    return current_user


@router.post("/password", response_model=TokenResponse)
def change_password(payload: PasswordChange, current_user: CurrentUser, db: DatabaseSession) -> TokenResponse:
    """Change only the caller's password, under a row lock, and renew its session."""
    user = db.scalar(select(User).where(User.id == current_user.id).with_for_update()
                     .execution_options(populate_existing=True))
    if user is None or not user.is_active:
        raise unauthorized()
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(400, "current_password_incorrect")
    if payload.new_password == payload.current_password:
        raise HTTPException(400, "new_password_unchanged")
    new_hash = hash_password(payload.new_password)
    response = TokenResponse(access_token=create_access_token(str(user.id), new_hash),
                             expires_in=get_settings().jwt_access_token_expire_minutes * 60)
    user.password_hash = new_hash
    db.commit()
    return response
