"""Cross-resource authorization, invalid updates, and database deletion rules."""

import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest

from tests.test_auth import TestingSession
from tests.test_sources import auth_headers, client, configure_test_jwt  # noqa: F401


def owner():
    return auth_headers(f"regression-{uuid.uuid4().hex}@example.com")


def source(auth):
    return client.post("/api/sources", headers=auth, json={
        "source_type": "text", "original_text": "Evidence",
    }).json()["id"]


def deadline(auth, source_id=None):
    return client.post("/api/deadlines", headers=auth, json={
        "title": "Due", "due_at": "2026-09-30T18:00:00+09:00", "source_id": source_id,
    }).json()["id"]


@pytest.mark.parametrize("kind", ["sources", "deadlines"])
def test_crud_permissions(kind):
    auth, other = owner(), owner()
    item_id = source(auth) if kind == "sources" else deadline(auth)
    path = f"/api/{kind}/{item_id}"
    assert client.get(f"/api/{kind}", headers=other).json() == []
    for method, body in (("get", None), ("patch", {"title": "Stolen"}), ("delete", None)):
        args = {} if body is None else {"json": body}
        assert client.request(method, path, headers=other, **args).status_code == 404
        assert client.request(method, path, **args).status_code == 401
    assert client.post(f"/api/{kind}", json={}).status_code == 401
    assert client.get(f"/api/{kind}/{uuid.uuid4()}", headers=auth).status_code == 404
    assert client.get(f"/api/{kind}?limit=0", headers=auth).status_code == 422
    assert client.get(f"/api/{kind}?offset=-1", headers=auth).status_code == 422
    assert client.delete(path, headers=auth).status_code == 204
    assert client.get(path, headers=auth).status_code == 404


@pytest.mark.parametrize("kind,field,value", [
    ("text", "original_text", "Evidence"), ("url", "original_url", "https://example.com/"),
])
def test_source_cannot_clear_required_content(kind, field, value):
    auth = owner()
    item = client.post("/api/sources", headers=auth, json={"source_type": kind, field: value}).json()
    path = f"/api/sources/{item['id']}"
    assert client.patch(path, headers=auth, json={field: None}).status_code == 422
    assert client.get(path, headers=auth).json()[field] == value
    assert client.patch(path, headers=auth, json={"title": "Valid update"}).status_code == 200


def test_deadline_update_permissions_and_validation():
    auth, other = owner(), owner()
    path = f"/api/deadlines/{deadline(auth)}"
    assert client.patch(path, headers=auth, json={"source_id": source(other)}).status_code == 404
    for change in ({"title": None}, {"due_at": None}, {"is_confirmed": None},
                   {"confidence": "1.01"}, {"due_at": "2026-09-30T12:00:00"}):
        assert client.patch(path, headers=auth, json=change).status_code == 422
    assert client.patch(path, headers=auth, json={"is_confirmed": True}).status_code == 200
    assert len(client.get("/api/deadlines?is_confirmed=true", headers=auth).json()) == 1
    assert client.get("/api/deadlines?is_confirmed=false", headers=auth).json() == []


def test_deletion_foreign_key_rules():
    auth = owner()
    source_id = source(auth)
    deadline_id = deadline(auth, source_id)
    task_id = client.post("/api/tasks", headers=auth, json={
        "title": "Draft", "deadline_id": deadline_id,
    }).json()["id"]
    event_id = client.post("/api/scheduled-events", headers=auth, json={
        "task_id": task_id, "start_at": "2026-09-20T09:00:00Z", "end_at": "2026-09-20T10:00:00Z",
    }).json()["id"]
    assert client.delete(f"/api/sources/{source_id}", headers=auth).status_code == 204
    assert client.get(f"/api/deadlines/{deadline_id}", headers=auth).json()["source_id"] is None
    assert client.delete(f"/api/deadlines/{deadline_id}", headers=auth).status_code == 204
    assert client.get(f"/api/tasks/{task_id}", headers=auth).json()["deadline_id"] is None
    assert client.delete(f"/api/tasks/{task_id}", headers=auth).status_code == 204
    assert client.get(f"/api/scheduled-events/{event_id}", headers=auth).status_code == 404


@pytest.mark.parametrize("case", ["expired", "missing_exp", "missing_sub", "invalid_sub", "signature"])
def test_invalid_signed_tokens(case):
    auth = owner()
    user_id = client.get("/api/auth/me", headers=auth).json()["id"]
    claims = {"sub": user_id, "exp": datetime.now(UTC) + timedelta(minutes=5)}
    key = "test-only-secret-key-with-32-bytes"
    if case == "expired":
        claims["exp"] = datetime.now(UTC) - timedelta(minutes=1)
    elif case == "missing_exp":
        del claims["exp"]
    elif case == "missing_sub":
        del claims["sub"]
    elif case == "invalid_sub":
        claims["sub"] = "invalid-uuid"
    else:
        key = "different-test-only-key-with-32-bytes"
    token = jwt.encode(claims, key, algorithm="HS256")
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_disabled_user_and_wrong_password():
    from app.models.user import User

    auth = owner()
    user = client.get("/api/auth/me", headers=auth).json()
    assert client.post("/api/auth/login", json={
        "email": user["email"], "password": "wrong-password",
    }).status_code == 401
    with TestingSession() as db:
        db.get(User, uuid.UUID(user["id"])).is_active = False
        db.commit()
    assert client.get("/api/auth/me", headers=auth).status_code == 401
    assert client.post("/api/auth/login", json={
        "email": user["email"], "password": "source-test-password",
    }).status_code == 401
