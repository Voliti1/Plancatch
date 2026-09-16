"""Environment-based application settings."""

from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Settings loaded from process variables or a local .env file."""

    app_name: str = "PlanCatch API"
    app_env: str = "development"
    cors_origins: list[str] = []
    db_host: str | None = None
    db_port: int = 5432
    db_name: str = "plancatch"
    db_user: str | None = None
    db_password: SecretStr | None = None
    jwt_secret_key: SecretStr | None = None
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 30
    aws_region: str = "ap-northeast-2"
    s3_bucket_name: str | None = None
    gemini_api_key: str | None = None
    google_client_id: str | None = None
    google_client_secret: str | None = None

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    """Return one cached settings instance for the running process."""
    return Settings()
