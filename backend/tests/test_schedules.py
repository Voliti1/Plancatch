"""Mixed schedule pagination must preserve ownership and literal search."""

import uuid

import pytest

from tests.test_sources import auth_headers, client, configure_test_jwt  # noqa: F401


def owner():
    return auth_headers(f"schedule-{uuid.uuid4().hex}@example.com")


def create(auth, kind, title, day=None):
    data = {"title": title}
    if kind == "deadlines":
        data["due_at"] = f"2026-11-{day:02d}T10:00:00Z"
    elif day:
        data["earliest_start"] = f"2026-11-{day:02d}T10:00:00Z"
    result = client.post(f"/api/{kind}", headers=auth, json=data)
    assert result.status_code == 201, result.text
    return result.json()


def test_mixed_global_paging_nulls_and_owner_filters():
    auth, other = owner(), owner()
    deadline = create(auth, "deadlines", "마감", 2)
    task = create(auth, "tasks", "할 일", 1)
    no_time = create(auth, "tasks", "미정")
    create(other, "deadlines", "다른 계정", 1)
    create(other, "tasks", "다른 계정", 1)
    expected = [
        ("task", task["id"]),
        ("deadline", deadline["id"]),
        ("task", no_time["id"]),
    ]
    for offset, pair in enumerate(expected):
        result = client.get(
            "/api/schedules", headers=auth, params={"limit": 1, "offset": offset}
        )
        assert result.status_code == 200, result.text
        assert result.headers["cache-control"] == "no-store"
        body = result.json()
        assert [(row["kind"], row["item"]["id"]) for row in body["entries"]] == [pair]
        assert body["has_more"] is (offset < 2)
    assert client.get("/api/schedules?offset=3", headers=auth).json() == {
        "entries": [],
        "has_more": False,
    }
    for kind in ("deadlines", "tasks"):
        body = client.get(f"/api/schedules?include_{kind}=false", headers=auth).json()
        assert all(row["kind"] != kind[:-1] for row in body["entries"])
    assert client.get(
        "/api/schedules?include_deadlines=false&include_tasks=false", headers=auth
    ).json() == {"entries": [], "has_more": False}


def test_title_search_is_literal_trimmed_and_case_insensitive():
    auth = owner()
    for kind in ("tasks", "deadlines"):
        create(auth, kind, "마감 A%_[제목]", 1)
        create(auth, kind, "마감 Another", 1)
    for query in (" a%_ ", "[제목]", "%_"):
        result = client.get("/api/schedules", headers=auth, params={"q": query}).json()
        assert len(result["entries"]) == 2
        assert all("A%_" in row["item"]["title"] for row in result["entries"])
    assert len(client.get("/api/schedules?q=마감", headers=auth).json()["entries"]) == 4


def test_equal_timestamps_have_stable_order_and_read_only():
    auth = owner()
    for _ in range(3):
        for kind in ("deadlines", "tasks"):
            create(auth, kind, "동일", 1)
    first = client.get("/api/schedules", headers=auth).json()["entries"]
    paged = [row for offset in (0, 2, 4) for row in client.get(
        f"/api/schedules?limit=2&offset={offset}", headers=auth
    ).json()["entries"]]
    assert first == paged
    assert len({(row["kind"], row["item"]["id"]) for row in first}) == 6
    assert [row["kind"] for row in first] == ["deadline"] * 3 + ["task"] * 3
    assert len(client.get("/api/deadlines", headers=auth).json()) == 3
    assert len(client.get("/api/tasks", headers=auth).json()) == 3


@pytest.mark.parametrize(
    "query",
    ["limit=0", "limit=101", "offset=-1", "include_tasks=wrong", "q=" + "a" * 256],
)
def test_validation(query):
    assert client.get("/api/schedules?" + query, headers=owner()).status_code == 422


def test_requires_authentication():
    assert client.get("/api/schedules").status_code == 401
