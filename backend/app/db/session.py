"""Database engine and session lifecycle."""

from collections.abc import Generator
from functools import lru_cache

from sqlalchemy import URL, create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings


def build_database_url() -> URL:
    """Build a PostgreSQL URL without manually encoding credentials."""
    settings = get_settings()
    if not settings.db_host or not settings.db_user or not settings.db_password:
        raise RuntimeError("Database environment variables are not configured")

    return URL.create(
        drivername="postgresql+psycopg",
        username=settings.db_user,
        password=settings.db_password.get_secret_value(),
        host=settings.db_host,
        port=settings.db_port,
        database=settings.db_name,
        query={"sslmode": "require"},
    )


@lru_cache
def get_engine() -> Engine:
    """Create one pooled SQLAlchemy engine per process."""
    return create_engine(build_database_url(), pool_pre_ping=True)


@lru_cache
def get_session_factory() -> sessionmaker[Session]:
    """Create one session factory per process."""
    return sessionmaker(bind=get_engine(), autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    """Provide a transaction-scoped database session to a request."""
    session = get_session_factory()()
    try:
        yield session
    finally:
        session.close()
