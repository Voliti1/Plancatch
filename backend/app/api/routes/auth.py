"""Authentication endpoints."""

from datetime import datetime, timezone
from secrets import token_urlsafe

import jwt
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Response, status
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.dependencies import AuthSession, CurrentUser, DatabaseSession, unauthorized
from app.core.config import get_settings
from app.core.security import (
    DUMMY_PASSWORD_HASH,
    create_access_token,
    hash_password,
    verify_access_password,
    verify_password,
)
from app.models.user import User
from app.schemas.user import (
    GoogleLogin,
    GoogleLoginChallenge,
    PasswordChange,
    PasswordRecoveryRequest,
    TimeZoneUpdate,
    TokenResponse,
    UserCreate,
    UserLogin,
    UserResponse,
)
from app.services import google_login, password_recovery


class AuthRoute(APIRoute):
    """Omit submitted values from authentication validation errors."""

    def get_route_handler(self):
        handler = super().get_route_handler()

        async def handle(request: Request) -> Response:
            try:
                return await handler(request)
            except RequestValidationError as exc:
                raise HTTPException(422, [
                    {"loc": error["loc"], "msg": error["msg"], "type": error["type"]}
                    for error in exc.errors()
                ]) from None

        return handle


router = APIRouter(prefix="/api/auth", tags=["authentication"], route_class=AuthRoute)


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


@router.post("/password-recovery", status_code=202)
def request_password_recovery(payload: PasswordRecoveryRequest, request: Request, tasks: BackgroundTasks) -> dict[str, bool]:
    if not password_recovery.mail_configured():
        raise HTTPException(503, "password_recovery_unavailable")
    address = request.client.host if request.client else "unknown"
    if not password_recovery.allow_request(address):
        raise HTTPException(429, "password_recovery_rate_limited")
    tasks.add_task(password_recovery.issue_and_send, str(payload.email).strip().lower())
    return {"accepted": True}


@router.post("/login", response_model=TokenResponse)
def login(payload: UserLogin, db: DatabaseSession, response: Response) -> TokenResponse:
    """Verify account credentials and return a bearer access token."""
    user = db.scalar(select(User).where(User.email == payload.email))
    if user is None:
        verify_password(payload.password, DUMMY_PASSWORD_HASH)
        raise unauthorized()

    if not user.is_active or not user.password_enabled:
        raise unauthorized()

    response.headers["Cache-Control"] = "no-store"
    if not verify_password(payload.password, user.password_hash):
        temporary_hash = password_recovery.active_recovery_hash(user)
        if temporary_hash is None or not verify_password(payload.password, temporary_hash):
            raise unauthorized()
        expires_at = password_recovery.utc(user.recovery_expires_at)
        return TokenResponse(
            access_token=create_access_token(str(user.id), temporary_hash, recovery_expires_at=expires_at),
            expires_in=max(0, int((expires_at - datetime.now(timezone.utc)).total_seconds())),
        )

    settings = get_settings()
    return TokenResponse(
        access_token=create_access_token(str(user.id), user.password_hash),
        expires_in=settings.jwt_access_token_expire_minutes * 60,
    )


def login_client_id() -> str | None:
    return getattr(get_settings(), "google_login_client_id", None)


@router.post("/google/challenge", response_model=GoogleLoginChallenge)
def google_challenge(request: Request, response: Response) -> GoogleLoginChallenge:
    """Bind the Google credential to this browser's sign-in attempt."""
    response.headers["Cache-Control"] = "no-store"
    if not (client_id := login_client_id()):
        return GoogleLoginChallenge()
    nonce = token_urlsafe(32)
    response.set_cookie(
        google_login.NONCE_COOKIE, nonce, max_age=google_login.NONCE_TTL,
        httponly=True, secure=request.url.scheme == "https" or get_settings().app_env == "production",
        samesite="strict", path=google_login.NONCE_PATH,
    )
    return GoogleLoginChallenge(client_id=client_id, nonce=google_login.challenge_nonce(nonce))


@router.post("/google", response_model=TokenResponse)
def login_with_google(
    payload: GoogleLogin, request: Request, response: Response, db: DatabaseSession,
) -> TokenResponse:
    if not (client_id := login_client_id()):
        raise HTTPException(503, "google_login_unavailable")
    nonce = request.cookies.get(google_login.NONCE_COOKIE)
    if not nonce or not nonce.isascii():
        raise HTTPException(400, "google_login_expired")
    try:
        subject, email, name = google_login.verify_credential(payload.credential, client_id, google_login.challenge_nonce(nonce))
    except jwt.PyJWKClientConnectionError as exc:
        raise HTTPException(503, "google_login_unavailable") from exc
    except jwt.PyJWTError as exc:
        raise HTTPException(400, "google_login_invalid") from exc

    user = db.scalar(select(User).where(User.google_subject == subject))
    if user is None:
        user = db.scalar(select(User).where(User.email == email).with_for_update())
        if user is not None:
            if not user.is_active:
                raise unauthorized()
            if user.google_subject == subject:
                pass  # The same identity was linked while this request was waiting.
            elif user.google_subject is not None:
                raise HTTPException(409, "google_account_already_linked")
            elif payload.current_password is None:
                raise HTTPException(409, "google_login_password_required")
            elif not verify_password(payload.current_password, user.password_hash):
                raise HTTPException(400, "google_login_password_incorrect")
            else:
                user.google_subject = subject
        else:
            user = User(email=email, display_name=name, google_subject=subject,
                        password_enabled=False, password_hash=hash_password(token_urlsafe(48)))
            db.add(user)
        try:
            db.commit()
        except IntegrityError as exc:
            db.rollback()
            user = db.scalar(select(User).where(User.google_subject == subject))
            if user is None:
                raise HTTPException(409, "google_login_retry") from exc

    if not user.is_active:
        raise unauthorized()
    response.headers["Cache-Control"] = "no-store"
    response.delete_cookie(google_login.NONCE_COOKIE, path=google_login.NONCE_PATH)
    return TokenResponse(
        access_token=create_access_token(str(user.id), user.password_hash),
        expires_in=get_settings().jwt_access_token_expire_minutes * 60,
    )


@router.get("/me", response_model=UserResponse)
def read_current_user(session: AuthSession) -> UserResponse:
    return UserResponse.model_validate(session.user).model_copy(
        update={"password_change_required": session.recovery},
    )


@router.patch("/time-zone", response_model=UserResponse)
def update_time_zone(payload: TimeZoneUpdate, current_user: CurrentUser, db: DatabaseSession) -> User:
    """Save the authenticated account's display time zone."""
    current_user.time_zone = payload.time_zone
    db.commit()
    db.refresh(current_user)
    return current_user


@router.post("/password", response_model=TokenResponse)
def change_password(payload: PasswordChange, session: AuthSession, db: DatabaseSession, http_response: Response) -> TokenResponse:
    """Change only the caller's password, under a row lock, and renew its session."""
    user = db.scalar(select(User).where(User.id == session.user.id).with_for_update()
                     .execution_options(populate_existing=True))
    if user is None or not user.is_active:
        raise unauthorized()
    if not user.password_enabled:
        raise HTTPException(403, "password_login_not_enabled")
    current_hash = password_recovery.active_recovery_hash(user) if session.recovery else user.password_hash
    if current_hash is None:
        raise unauthorized()
    try:
        verify_access_password(session.claims, current_hash)
    except jwt.InvalidTokenError:
        raise unauthorized() from None
    if not verify_password(payload.current_password, current_hash):
        raise HTTPException(400, "current_password_incorrect")
    if payload.new_password == payload.current_password:
        raise HTTPException(400, "new_password_unchanged")
    new_hash = hash_password(payload.new_password)
    response = TokenResponse(access_token=create_access_token(str(user.id), new_hash),
                             expires_in=get_settings().jwt_access_token_expire_minutes * 60)
    user.password_hash = new_hash
    user.recovery_password_hash = None
    user.recovery_expires_at = None
    db.commit()
    http_response.headers["Cache-Control"] = "no-store"
    return response
