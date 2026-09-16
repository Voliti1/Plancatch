"""Tests for account registration."""

from collections.abc import Generator

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.session import get_db
from app.main import app

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
Base.metadata.create_all(engine)


def override_get_db() -> Generator[Session, None, None]:
    with TestingSession() as session:
        yield session


app.dependency_overrides[get_db] = override_get_db
client = TestClient(app)


def test_signup_creates_user_without_returning_password() -> None:
    response = client.post(
        "/api/auth/signup",
        json={
            "email": "NewUser@Example.com",
            "password": "secure-password",
            "display_name": "Plan Catcher",
        },
    )

    assert response.status_code == 201
    assert response.json()["email"] == "newuser@example.com"
    assert response.json()["display_name"] == "Plan Catcher"
    assert "password" not in response.json()
    assert "password_hash" not in response.json()


def test_signup_rejects_duplicate_email() -> None:
    first_response = client.post(
        "/api/auth/signup",
        json={
            "email": "duplicate@example.com",
            "password": "secure-password",
        },
    )
    response = client.post(
        "/api/auth/signup",
        json={
            "email": "DUPLICATE@example.com",
            "password": "another-password",
        },
    )

    assert first_response.status_code == 201
    assert response.status_code == 409


def test_signup_validates_email_and_password() -> None:
    response = client.post(
        "/api/auth/signup",
        json={"email": "not-an-email", "password": "short"},
    )

    assert response.status_code == 422
