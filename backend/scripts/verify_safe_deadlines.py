"""Opt-in live API/RDS smoke check using only a new, self-cleaning test account.

Run on EC2 from backend: PYTHONPATH=. ../.venv312/bin/python scripts/verify_safe_deadlines.py
No AI call, calendar call, user credential output or modification of existing accounts.
"""

import json
import secrets
import uuid
from datetime import UTC, datetime
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_engine
from app.models.deadline import Deadline
from app.models.user import User


def main() -> None:
    email = f"safe-smoke-{uuid.uuid4().hex}@example.com"
    password = secrets.token_urlsafe(24)
    headers = {"Content-Type": "application/json"}
    user_id = None

    def api(method, path, body=None, expected=200):
        request = Request(
            "http://127.0.0.1" + path,
            data=json.dumps(body).encode() if body is not None else None,
            headers=headers, method=method,
        )
        try:
            with urlopen(request, timeout=15) as response:
                assert response.status == expected
                raw = response.read()
                return json.loads(raw) if raw else None
        except HTTPError as exc:
            if exc.code != expected:
                raise RuntimeError(f"Unexpected HTTP status {exc.code}") from None
            return None

    try:
        user = api("POST", "/api/auth/signup", {"email": email, "password": password}, expected=201)
        user_id = uuid.UUID(user["id"])
        headers["Authorization"] = "Bearer " + api("POST", "/api/auth/login", {
            "email": email, "password": password,
        })["access_token"]
        item = api("POST", "/api/deadlines", {
            "title": "Safety deadline verification", "due_at": "2026-10-05T18:00:00+09:00",
            "safety_buffer_minutes": 180,
        }, expected=201)
        deadline_id = uuid.UUID(item["id"])
        path = f"/api/deadlines/{deadline_id}"
        assert item["due_at"] == "2026-10-05T09:00:00Z"
        assert item["safe_due_at"] == "2026-10-05T06:00:00Z"
        with Session(get_engine()) as db:
            saved = db.scalar(select(Deadline).where(
                Deadline.id == deadline_id, Deadline.user_id == user_id,
            ))
            assert saved is not None and saved.safety_buffer_minutes == 180
            assert saved.safe_due_at == datetime(2026, 10, 5, 6, tzinfo=UTC)
        assert api("GET", path)["safe_due_at"] == item["safe_due_at"]
        assert api("GET", "/api/deadlines")[0]["safe_due_at"] == item["safe_due_at"]
        changed = api("PATCH", path, {"due_at": "2026-10-06T18:00:00+09:00"})
        assert changed["safe_due_at"] == "2026-10-06T06:00:00Z"
        api("PATCH", path, {"safety_buffer_minutes": -1}, expected=422)
        assert api("GET", path)["safety_buffer_minutes"] == 180
        cleared = api("PATCH", path, {"safety_buffer_minutes": None})
        assert cleared["safe_due_at"] is None and cleared["safety_buffer_minutes"] is None
        assert cleared["due_at"] == changed["due_at"]
        with Session(get_engine()) as db:
            assert db.scalar(select(Deadline.safety_buffer_minutes).where(Deadline.id == deadline_id)) is None
        assert api("GET", "/api/tasks") == []
        assert api("GET", "/api/scheduled-events") == []
        print("LIVE_NGINX_API_RDS_SAFE_DEADLINES_OK")
    finally:
        if user_id is not None:
            with Session(get_engine()) as db:
                user = db.scalar(select(User).where(User.id == user_id, User.email == email))
                if user is None:
                    raise RuntimeError("Synthetic cleanup target missing")
                db.delete(user)
                db.commit()
            print("SYNTHETIC_TEST_DATA_REMOVED")


if __name__ == "__main__":
    main()
