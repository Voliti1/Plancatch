"""Source material API schemas."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, model_validator


class SourceCreate(BaseModel):
    """URL or text material submitted for later extraction."""

    source_type: Literal["url", "text"]
    title: str | None = Field(default=None, min_length=1, max_length=255)
    original_url: AnyHttpUrl | None = None
    original_text: str | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def validate_source_content(self) -> "SourceCreate":
        """Require content that matches the selected source type."""
        if self.source_type == "url" and self.original_url is None:
            raise ValueError("original_url is required for URL sources")
        if self.source_type == "text" and not self.original_text:
            raise ValueError("original_text is required for text sources")
        return self


class SourceUpdate(BaseModel):
    """Editable fields for URL and text source material."""

    title: str | None = Field(default=None, min_length=1, max_length=255)
    original_url: AnyHttpUrl | None = None
    original_text: str | None = Field(default=None, min_length=1)


class SourceResponse(BaseModel):
    """Source material returned to its owner."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    source_type: str
    title: str | None
    original_url: str | None
    storage_key: str | None
    original_text: str | None
    extracted_text: str | None
    processing_status: str
    error_message: str | None
    created_at: datetime
    updated_at: datetime
