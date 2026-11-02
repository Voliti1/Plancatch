"""Public API deletion must preserve sources while registered deadlines reference them."""

import uuid

import pytest

from tests.test_ai_analyses import fake_provider as fake_provider  # noqa: PLC0414
from tests.test_ai_analyses import ready_analysis
from tests.test_sources import auth_headers, client, configure_test_jwt  # noqa: F401


def material(auth):
    result = client.post(
        "/api/sources",
        headers=auth,
        json={
            "source_type": "text",
            "title": "보호할 자료",
            "original_text": "공고 원문",
        },
    )
    assert result.status_code == 201
    return result.json()["id"]


def deadline(auth, source_id, confirmed=True):
    response = client.post(
        "/api/deadlines",
        headers=auth,
        json={
            "source_id": source_id,
            "title": "등록된 마감일",
            "due_at": "2026-11-03T23:59:00+09:00",
            "is_confirmed": confirmed,
        },
    )
    assert response.status_code == 201
    return response.json()["id"]


def test_approved_analysis_and_all_related_data_survive_rejected_source_delete():
    analysis, source_id, auth = ready_analysis()
    path = "/api/sources/" + source_id
    before = client.get(path, headers=auth).json()
    approved = client.post(
        "/api/ai-analyses/" + analysis["id"] + "/approve",
        headers=auth,
        json={"revision": 1},
    )
    assert approved.status_code == 200
    deadline_id = approved.json()["approved_deadline_ids"][0]
    task = client.post(
        "/api/tasks",
        headers=auth,
        json={"title": "유지할 작업", "deadline_id": deadline_id},
    ).json()
    denied = client.delete(path, headers=auth)
    assert (
        denied.status_code == 409 and denied.json()["detail"] == "source_has_deadlines"
    )
    assert client.get(path, headers=auth).json() == before
    assert (
        client.get("/api/ai-analyses/" + analysis["id"], headers=auth).json()["status"]
        == "approved"
    )
    assert (
        client.get("/api/deadlines/" + deadline_id, headers=auth).json()["source_id"]
        == source_id
    )
    assert (
        client.get("/api/tasks/" + task["id"], headers=auth).json()["deadline_id"]
        == deadline_id
    )
    assert (
        client.delete("/api/deadlines/" + deadline_id, headers=auth).status_code == 204
    )
    assert client.get(path, headers=auth).status_code == 404
    assert (
        client.get("/api/ai-analyses/" + analysis["id"], headers=auth).status_code
        == 404
    )
    assert (
        client.get("/api/tasks/" + task["id"], headers=auth).json()["deadline_id"]
        is None
    )


@pytest.mark.parametrize("confirmed", [True, False])
def test_manual_deadline_relink_and_unlink_update_deletion_protection(confirmed):
    auth = auth_headers("delete-guard-" + uuid.uuid4().hex + "@example.com")
    first, second = material(auth), material(auth)
    identity = deadline(auth, first, confirmed)
    assert client.delete("/api/sources/" + first, headers=auth).status_code == 409
    assert (
        client.patch(
            "/api/deadlines/" + identity, headers=auth, json={"source_id": second}
        ).status_code
        == 200
    )
    assert client.delete("/api/sources/" + first, headers=auth).status_code == 204
    assert client.delete("/api/sources/" + second, headers=auth).status_code == 409
    assert (
        client.patch(
            "/api/deadlines/" + identity, headers=auth, json={"source_id": None}
        ).status_code
        == 200
    )
    assert client.delete("/api/sources/" + second, headers=auth).status_code == 204
    assert client.get("/api/deadlines/" + identity, headers=auth).status_code == 200


def test_all_linked_deadlines_must_be_removed_and_ownership_is_not_disclosed():
    auth = auth_headers("delete-owner-" + uuid.uuid4().hex + "@example.com")
    other = auth_headers("delete-other-" + uuid.uuid4().hex + "@example.com")
    identity = material(auth)
    path = "/api/sources/" + identity
    first, second = deadline(auth, identity), deadline(auth, identity, False)
    assert client.delete(path).status_code == 401
    assert client.delete(path, headers=other).status_code == 404
    assert client.delete("/api/deadlines/" + first, headers=auth).status_code == 204
    assert client.delete(path, headers=auth).status_code == 409
    assert client.delete("/api/deadlines/" + second, headers=auth).status_code == 204
    assert client.get(path, headers=auth).status_code == 404
