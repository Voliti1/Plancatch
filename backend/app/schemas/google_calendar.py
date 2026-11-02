"""Public connection metadata only: never OAuth codes, tokens or ciphertext."""

from datetime import datetime

from pydantic import BaseModel


class GoogleConnectionStatus(BaseModel):
    configured: bool
    connected: bool
    reconnect_required: bool = False
    pending: bool = False
    connected_at: datetime | None = None
    refresh_expires_at: datetime | None = None


class GoogleConnectResponse(BaseModel):
    authorization_url: str
    expires_in: int


class GoogleDisconnectResponse(BaseModel):
    disconnected: bool = True
    google_revoked: bool | None
    manual_revoke_required: bool
