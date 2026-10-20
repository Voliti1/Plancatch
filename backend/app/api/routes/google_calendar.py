"""Google Calendar connection lifecycle, not calendar event synchronization."""

import hmac
import logging
import re
import secrets
from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import AwareDatetime
from sqlalchemy import delete, select, update

from app.api.dependencies import CurrentUser, DatabaseSession
from app.models.google_calendar import GoogleCalendarConnection, GoogleOAuthRequest
from app.models.user import User
from app.schemas.google_calendar import (
    GoogleConnectionStatus,
    GoogleConnectResponse,
    GoogleDisconnectResponse,
)
from app.schemas.google_event import GoogleEventsPage
from app.services import google_calendar as google
from app.services import google_events
from app.services.google_completion import completion_response

router = APIRouter(prefix=google.PREFIX, tags=["google-calendar"])
logger = logging.getLogger(__name__)
SAFE_HEADERS = {"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"}


def _config():
    try:
        return google.configuration()
    except google.CalendarConfigurationError:
        raise HTTPException(503, "Google Calendar 연결 설정이 필요합니다.") from None


def _utc(value):
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _lock_user(db, user_id):
    # Start/finalize/disconnect always lock in this order. A disconnect or newer
    # attempt invalidates an in-flight exchange before its credentials can persist.
    user = db.scalar(
        select(User)
        .where(User.id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if user is None or not user.is_active:
        raise HTTPException(401, "로그인이 필요합니다.")
    return user


def _finish(code, config):
    logger.info("google_calendar_callback_result=%s", code)
    response = RedirectResponse(
        google.PREFIX + "/complete?result=" + code,
        status_code=303,
        headers=SAFE_HEADERS,
    )
    response.delete_cookie(
        google.COOKIE,
        path=google.CALLBACK_PATH,
        secure=config.secure_cookie,
        httponly=True,
        samesite="lax",
    )
    return response


@router.get("/status", response_model=GoogleConnectionStatus)
def connection_status(
    current_user: CurrentUser, db: DatabaseSession, response: Response
):
    response.headers.update(SAFE_HEADERS)
    try:
        config = google.configuration()
    except google.CalendarConfigurationError:
        return GoogleConnectionStatus(configured=False, connected=False)
    connection = db.get(GoogleCalendarConnection, current_user.id)
    pending = (
        db.scalar(
            select(GoogleOAuthRequest.state_hash).where(
                GoogleOAuthRequest.user_id == current_user.id,
                GoogleOAuthRequest.expires_at > datetime.now(UTC),
            )
        )
        is not None
    )
    reconnect = False
    if connection is not None:
        try:
            google.decrypt(
                config, current_user.id, "refresh", connection.refresh_token_ciphertext
            )
            reconnect = google.SCOPE not in connection.scopes.split()
            if connection.refresh_expires_at is not None:
                reconnect = reconnect or _utc(
                    connection.refresh_expires_at
                ) <= datetime.now(UTC)
        except google.CalendarProviderError:
            reconnect = True
    return GoogleConnectionStatus(
        configured=True,
        connected=connection is not None and not reconnect,
        reconnect_required=reconnect,
        pending=pending,
        connected_at=connection.connected_at if connection else None,
        refresh_expires_at=connection.refresh_expires_at if connection else None,
    )


@router.post("/connect", response_model=GoogleConnectResponse)
def connect_google(
    current_user: CurrentUser, db: DatabaseSession, request: Request, response: Response
):
    config = _config()
    # The state cookie must be issued by the callback's exact API origin. Avoid
    # silently creating a flow that can never return its browser-binding cookie.
    origin = urlsplit(config.redirect_uri)
    if (
        request.url.scheme != origin.scheme
        or request.url.netloc.lower() != origin.netloc.lower()
    ):
        raise HTTPException(
            409, "등록한 Google 콜백과 동일한 API 주소로 연결을 시작해 주세요."
        )
    _lock_user(db, current_user.id)
    state = secrets.token_urlsafe(32)
    browser = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    db.execute(
        delete(GoogleOAuthRequest).where(GoogleOAuthRequest.user_id == current_user.id)
    )
    db.add(
        GoogleOAuthRequest(
            state_hash=google.digest(state),
            user_id=current_user.id,
            browser_hash=google.digest(browser),
            verifier_ciphertext=google.encrypt(
                config, current_user.id, "pkce", verifier
            ),
            expires_at=datetime.now(UTC) + timedelta(seconds=google.TTL_SECONDS),
            consumed=False,
        )
    )
    db.commit()
    response.headers.update(SAFE_HEADERS)
    response.set_cookie(
        google.COOKIE,
        browser,
        max_age=google.TTL_SECONDS,
        path=google.CALLBACK_PATH,
        secure=config.secure_cookie,
        httponly=True,
        samesite="lax",
    )
    return GoogleConnectResponse(
        authorization_url=google.authorization_url(config, state, verifier),
        expires_in=google.TTL_SECONDS,
    )


@router.get("/callback")
def google_callback(request: Request, db: DatabaseSession):
    config = _config()
    params = request.query_params
    # Manually bound inputs: FastAPI validation errors must not echo auth codes.
    for name in ("state", "code", "error"):
        if len(params.getlist(name)) > 1:
            raise HTTPException(400, "유효하지 않은 Google 인증 요청입니다.")
    state = params.get("state", "")
    browser = request.cookies.get(google.COOKIE, "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{43}", state) or not re.fullmatch(
        r"[A-Za-z0-9_-]{43}", browser
    ):
        raise HTTPException(
            400, "인증 요청이 없거나 만료되었습니다. 연결을 다시 시작해 주세요."
        )
    row = db.get(GoogleOAuthRequest, google.digest(state))
    if (
        row is None
        or row.consumed
        or _utc(row.expires_at) <= datetime.now(UTC)
        or not hmac.compare_digest(row.browser_hash, google.digest(browser))
    ):
        raise HTTPException(
            400, "인증 요청이 없거나 만료되었습니다. 연결을 다시 시작해 주세요."
        )
    user_id = row.user_id
    verifier_ciphertext = row.verifier_ciphertext
    consumed = db.execute(
        update(GoogleOAuthRequest)
        .where(
            GoogleOAuthRequest.state_hash == google.digest(state),
            GoogleOAuthRequest.browser_hash == google.digest(browser),
            GoogleOAuthRequest.consumed.is_(False),
            GoogleOAuthRequest.expires_at > datetime.now(UTC),
        )
        .values(consumed=True)
        .returning(GoogleOAuthRequest.state_hash),
        execution_options={"synchronize_session": False},
    ).scalar_one_or_none()
    db.commit()  # Single consumption is visible before any outbound call.
    if consumed is None:
        raise HTTPException(400, "이미 처리했거나 만료된 인증 요청입니다.")
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        return _finish("cancelled", config)
    try:
        if "error" in params:
            raise google.CalendarProviderError("cancelled")
        code = params.get("code", "")
        if not code or len(code) > 4096:
            raise google.CalendarProviderError()
        verifier = google.decrypt(config, user_id, "pkce", verifier_ciphertext)
        refresh, scopes, refresh_expiry = google.exchange_code(config, code, verifier)
        _lock_user(db, user_id)
        active = db.scalar(
            select(GoogleOAuthRequest)
            .where(
                GoogleOAuthRequest.state_hash == google.digest(state),
                GoogleOAuthRequest.user_id == user_id,
                GoogleOAuthRequest.consumed.is_(True),
                GoogleOAuthRequest.expires_at > datetime.now(UTC),
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if active is None:
            # Disconnect/new connect won the race. Never re-create its old link.
            return _finish("cancelled", config)
        connection = db.get(GoogleCalendarConnection, user_id)
        if connection is None:
            connection = GoogleCalendarConnection(user_id=user_id)
            db.add(connection)
        connection.refresh_token_ciphertext = google.encrypt(
            config, user_id, "refresh", refresh
        )
        connection.scopes = scopes
        connection.connected_at = datetime.now(UTC)
        connection.refresh_expires_at = refresh_expiry
        db.delete(active)
        db.commit()
        return _finish("connected", config)
    except google.CalendarProviderError as error:
        db.execute(
            delete(GoogleOAuthRequest).where(
                GoogleOAuthRequest.state_hash == google.digest(state),
                GoogleOAuthRequest.user_id == user_id,
            )
        )
        db.commit()
        return _finish(error.code, config)


@router.delete("/connection", response_model=GoogleDisconnectResponse)
def disconnect_google(
    current_user: CurrentUser, db: DatabaseSession, response: Response
):
    response.headers.update(SAFE_HEADERS)
    _lock_user(db, current_user.id)
    pending = (
        db.scalar(
            select(GoogleOAuthRequest.state_hash).where(
                GoogleOAuthRequest.user_id == current_user.id
            )
        )
        is not None
    )
    db.execute(
        delete(GoogleOAuthRequest).where(GoogleOAuthRequest.user_id == current_user.id)
    )
    connection = db.get(GoogleCalendarConnection, current_user.id)
    revoked = None
    if connection is not None:
        revoked = False
        try:
            config = google.configuration()
            token = google.decrypt(
                config, current_user.id, "refresh", connection.refresh_token_ciphertext
            )
            revoked = google.revoke_token(token)
        except (google.CalendarConfigurationError, google.CalendarProviderError):
            pass  # Local disconnection must still work if the encryption key is lost.
        db.delete(connection)
    db.commit()
    response.delete_cookie(
        google.COOKIE, path=google.CALLBACK_PATH, httponly=True, samesite="lax"
    )
    return GoogleDisconnectResponse(
        google_revoked=revoked,
        manual_revoke_required=revoked is False or (revoked is None and pending),
    )


@router.get("/complete", response_class=HTMLResponse)
def complete(request: Request):
    return completion_response(request.query_params.get("result", ""))


@router.get("/events", response_model=GoogleEventsPage)
def read_google_events(
    current_user: CurrentUser,
    db: DatabaseSession,
    response: Response,
    start_from: AwareDatetime,
    end_before: AwareDatetime,
):
    response.headers.update(SAFE_HEADERS)
    if not timedelta(0) < end_before - start_from <= timedelta(days=62):
        raise HTTPException(422, "구글 일정 조회 기간은 0일 초과 62일 이하여야 합니다.")
    config = _config()
    _lock_user(db, current_user.id)
    connection = db.get(GoogleCalendarConnection, current_user.id)
    if connection is None:
        raise HTTPException(409, "구글 계정을 먼저 연결해 주세요.")
    if google.SCOPE not in connection.scopes.split() or (
        connection.refresh_expires_at is not None
        and _utc(connection.refresh_expires_at) <= datetime.now(UTC)
    ):
        raise HTTPException(409, "구글 계정을 다시 연결해 주세요.")
    try:
        refresh = google.decrypt(
            config, current_user.id, "refresh", connection.refresh_token_ciphertext
        )
        token, rotated = google_events.refresh_access(config, refresh)
        if rotated is not None:
            connection.refresh_token_ciphertext = google.encrypt(
                config, current_user.id, "refresh", rotated
            )
        # Keep a rotated credential even if the later read fails. A read already
        # in flight may finish after disconnect, but never writes a calendar event.
        db.commit()
        return google_events.list_primary(token, _utc(start_from), _utc(end_before))
    except google.CalendarProviderError:
        raise HTTPException(
            409, "연결 정보를 확인할 수 없습니다. 구글 계정을 다시 연결해 주세요."
        ) from None
    except google_events.GoogleEventsError as error:
        raise HTTPException(error.status, str(error)) from None
