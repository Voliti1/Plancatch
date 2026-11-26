"""Kakao sign-in, explicit account linking, and separate calendar consent."""

import base64
import hashlib
import hmac
from datetime import UTC, datetime, timedelta
from secrets import token_urlsafe
from urllib.parse import urlencode

import jwt
from cryptography.fernet import InvalidToken
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.dependencies import CurrentUser, DatabaseSession, unauthorized
from app.api.routes.auth import AuthRoute
from app.core.config import get_settings
from app.core.security import create_access_token, get_jwt_secret, hash_password
from app.models.user import User
from app.schemas.user import TokenResponse
from app.services import kakao

router = APIRouter(prefix="/api/kakao", tags=["kakao"], route_class=AuthRoute)
TTL = 600


class Callback(BaseModel):
    code: str = Field(min_length=1, max_length=1024, pattern=r"^[!-~]+$")
    state: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


def configured(calendar=False):
    config = kakao.configuration()
    if config is None or (calendar and config.calendar_cipher is None):
        raise HTTPException(503, "kakao_unavailable")
    return config


def lock_user(db, user_id):
    user = db.scalar(select(User).where(User.id == user_id).with_for_update().execution_options(populate_existing=True))
    if user is None or not user.is_active:
        raise unauthorized()
    return user


def start(response, config, mode, user_id=None, state=None):
    state = state or token_urlsafe(24)
    verifier = token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    envelope = jwt.encode({
        "purpose": "kakao_" + mode, "state": state, "verifier": verifier,
        "user": str(user_id) if user_id else None, "exp": datetime.now(UTC) + timedelta(seconds=TTL),
    }, get_jwt_secret(), algorithm="HS256")
    response.headers["Cache-Control"] = "no-store"
    response.set_cookie("plancatch_kakao_" + mode, envelope, max_age=TTL,
                        path="/api/kakao", secure=config.secure, httponly=True, samesite="lax")
    params = {
        "client_id": config.key, "redirect_uri": config.redirect_uri, "response_type": "code",
        "state": state, "code_challenge": challenge, "code_challenge_method": "S256",
    }
    if mode == "login":
        params["scope"] = "account_email"
    elif mode == "calendar":
        params["scope"] = "talk_calendar"
    return {"authorization_url": kakao.AUTHORIZE + "?" + urlencode(params)}


def finish(payload, request, response, config, mode, user_id=None):
    try:
        envelope = jwt.decode(request.cookies.get("plancatch_kakao_" + mode, ""),
                              get_jwt_secret(), algorithms=["HS256"], options={"require": ["exp"]})
        if (envelope.get("purpose") != "kakao_" + mode
                or envelope.get("user") != (str(user_id) if user_id else None)
                or not hmac.compare_digest(envelope["state"], payload.state)):
            raise ValueError
        verifier = envelope["verifier"]
    except (jwt.InvalidTokenError, ValueError, TypeError, KeyError):
        raise HTTPException(400, "kakao_expired") from None
    try:
        token = kakao.exchange(config, {
            "grant_type": "authorization_code", "code": payload.code,
            "redirect_uri": config.redirect_uri, "code_verifier": verifier,
        })
    except kakao.ProviderError:
        raise HTTPException(502, "kakao_provider_error") from None
    response.headers["Cache-Control"] = "no-store"
    response.delete_cookie("plancatch_kakao_" + mode, path="/api/kakao", secure=config.secure, httponly=True, samesite="lax")
    return token


def profile(token):
    try:
        return kakao.identity(token["access_token"])
    except kakao.ProviderError:
        raise HTTPException(502, "kakao_provider_error") from None


@router.get("/login/status")
def login_status():
    return {"configured": kakao.configuration() is not None}


@router.post("/login/start")
def login_start(response: Response):
    return start(response, configured(), "login")


@router.post("/login/complete", response_model=TokenResponse)
def login_complete(payload: Callback, request: Request, response: Response, db: DatabaseSession):
    subject, email = profile(finish(payload, request, response, configured(), "login"))
    user = db.scalar(select(User).where(User.kakao_subject == subject))
    if user is None:
        if email is None:
            raise HTTPException(403, "kakao_verified_email_required")
        if db.scalar(select(User.id).where(User.email == email)):
            raise HTTPException(409, "kakao_link_existing")
        user = User(email=email, kakao_subject=subject, password_enabled=False,
                    password_hash=hash_password(token_urlsafe(48)))
        db.add(user)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            user = db.scalar(select(User).where(User.kakao_subject == subject))
            if user is None:
                raise HTTPException(409, "kakao_link_existing") from None
    if not user.is_active:
        raise unauthorized()
    return TokenResponse(access_token=create_access_token(str(user.id), user.password_hash),
                         expires_in=get_settings().jwt_access_token_expire_minutes * 60)


@router.get("/account/status")
def account_status(user: CurrentUser):
    return {"configured": kakao.configuration() is not None, "connected": bool(user.kakao_subject)}


@router.post("/account/start")
def account_start(response: Response, user: CurrentUser):
    return start(response, configured(), "account", user.id)


@router.post("/account/complete")
def account_complete(payload: Callback, request: Request, response: Response, user: CurrentUser, db: DatabaseSession):
    subject, _ = profile(finish(payload, request, response, configured(), "account", user.id))
    owner = lock_user(db, user.id)
    if owner.kakao_subject and owner.kakao_subject != subject:
        raise HTTPException(409, "kakao_identity_in_use")
    owner.kakao_subject = subject
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "kakao_identity_in_use") from None
    return {"connected": True}


@router.get("/calendar/status")
def calendar_status(user: CurrentUser):
    config = kakao.configuration()
    return {"configured": bool(config and config.calendar_cipher), "connected": bool(user.kakao_calendar_token)}


@router.post("/calendar/start")
def calendar_start(response: Response, user: CurrentUser, db: DatabaseSession):
    config = configured(calendar=True)
    owner = lock_user(db, user.id)
    state = token_urlsafe(24)
    owner.kakao_calendar_state = state
    db.commit()
    return start(response, config, "calendar", user.id, state)


@router.post("/calendar/complete")
def calendar_complete(payload: Callback, request: Request, response: Response, user: CurrentUser, db: DatabaseSession):
    config = configured(calendar=True)
    if user.kakao_calendar_state != payload.state:
        raise HTTPException(400, "kakao_expired")
    token = finish(payload, request, response, config, "calendar", user.id)
    try:
        calendars = kakao.calendar_names(token["access_token"])
        grant = calendar_grant(token)
    except (kakao.ProviderError, KeyError, TypeError, ValueError):
        raise HTTPException(502, "kakao_calendar_permission_required") from None
    owner = lock_user(db, user.id)
    if owner.kakao_calendar_state != payload.state:
        raise HTTPException(400, "kakao_expired")
    owner.kakao_calendar_token = kakao.seal(config, owner.id, grant)
    owner.kakao_calendar_state = None
    db.commit()
    return {"connected": True, "calendars": calendars}


def calendar_grant(token, old_refresh=None):
    refresh = token.get("refresh_token", old_refresh)
    if not isinstance(refresh, str) or not refresh:
        raise ValueError
    return {
        "access_token": token["access_token"], "refresh_token": refresh,
        "expires": int(datetime.now(UTC).timestamp()) + max(0, int(token["expires_in"]) - 30),
    }


@router.post("/calendar/calendars")
def read_calendars(user: CurrentUser, db: DatabaseSession):
    config = configured(calendar=True)
    owner = lock_user(db, user.id)
    if owner.kakao_calendar_token is None:
        raise HTTPException(409, "kakao_not_connected")
    try:
        grant = kakao.unseal(config, owner.id, owner.kakao_calendar_token)
        if grant["expires"] <= datetime.now(UTC).timestamp():
            token = kakao.exchange(config, {"grant_type": "refresh_token", "refresh_token": grant["refresh_token"]})
            grant = calendar_grant(token, grant["refresh_token"])
            owner.kakao_calendar_token = kakao.seal(config, owner.id, grant)
        db.commit()
        calendars = kakao.calendar_names(grant["access_token"])
    except (kakao.ProviderError, InvalidToken, KeyError, ValueError, TypeError):
        raise HTTPException(502, "kakao_calendar_reconnect") from None
    return {"calendars": calendars}


@router.delete("/calendar/connection")
def disconnect(user: CurrentUser, db: DatabaseSession):
    owner = lock_user(db, user.id)
    owner.kakao_calendar_token = None
    owner.kakao_calendar_state = None
    db.commit()
    return {"connected": False}
