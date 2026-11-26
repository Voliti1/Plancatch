"""User API schemas."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class UserCreate(BaseModel):
    """Fields accepted when a user creates an account."""

    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    display_name: str | None = Field(default=None, min_length=1, max_length=100)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: EmailStr) -> str:
        """Store emails in a consistent lowercase form."""
        return str(value).strip().lower()

    @field_validator("display_name")
    @classmethod
    def normalize_display_name(cls, value: str | None) -> str | None:
        """Remove surrounding whitespace from optional display names."""
        if value is None:
            return None
        return value.strip() or None


class UserResponse(BaseModel):
    """Safe public representation of a user account."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: EmailStr
    display_name: str | None
    is_active: bool
    created_at: datetime
    time_zone: str
    password_enabled: bool = True
    password_change_required: bool = False


class PasswordRecoveryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: EmailStr


class UserLogin(BaseModel):
    """Email and password accepted by the login endpoint."""

    email: EmailStr
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: EmailStr) -> str:
        """Match the normalized email stored during registration."""
        return str(value).strip().lower()


class TokenResponse(BaseModel):
    """Bearer access token returned after successful login."""

    access_token: str
    token_type: str = "bearer"
    expires_in: int


class GoogleLogin(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    credential: str = Field(min_length=1, max_length=8192)
    current_password: str | None = Field(default=None, min_length=1, max_length=128)


class GoogleLoginChallenge(BaseModel):
    client_id: str | None = None
    nonce: str | None = None


class PasswordChange(BaseModel):
    """A signed-in user must prove the current password before replacing it."""

    model_config = ConfigDict(extra="forbid")
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class TimeZoneUpdate(BaseModel):
    """A supported IANA time zone from the workspace picker."""

    model_config = ConfigDict(extra="forbid")
    time_zone: str = Field(max_length=64)

    @field_validator("time_zone")
    @classmethod
    def supported_zone(cls, value: str) -> str:
        if value not in SUPPORTED_TIME_ZONES:
            raise ValueError("지원하는 시간대를 선택해 주세요.")
        return value


# Keep this list aligned with frontend/lib/date/time-zones.ts.
SUPPORTED_TIME_ZONES = frozenset({
    "Pacific/Honolulu",
    "America/Anchorage",
    "America/Los_Angeles",
    "America/Denver",
    "America/Phoenix",
    "America/Chicago",
    "America/Mexico_City",
    "America/New_York",
    "America/Toronto",
    "America/Sao_Paulo",
    "UTC",
    "Europe/London",
    "Europe/Paris",
    "Europe/Berlin",
    "Europe/Athens",
    "Africa/Johannesburg",
    "Europe/Istanbul",
    "Asia/Dubai",
    "Asia/Karachi",
    "Asia/Kolkata",
    "Asia/Kathmandu",
    "Asia/Dhaka",
    "Asia/Bangkok",
    "Asia/Ho_Chi_Minh",
    "Asia/Jakarta",
    "Asia/Shanghai",
    "Asia/Taipei",
    "Asia/Singapore",
    "Australia/Perth",
    "Asia/Tokyo",
    "Australia/Adelaide",
    "Australia/Brisbane",
    "Australia/Sydney",
    "Pacific/Auckland",
    "Asia/Seoul",
})


class ProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    display_name: str | None = Field(default=None, max_length=100)

    @field_validator("display_name")
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None


class AccountDelete(BaseModel):
    """Reauthenticate the caller without allowing an alternate account ID."""
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    current_password: str | None = Field(default=None, min_length=1, max_length=128)
    confirmation_email: EmailStr | None = None
