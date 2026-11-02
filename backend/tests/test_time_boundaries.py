"""Out-of-range UTC conversion must reject input and retain saved task/event data."""
import uuid

import pytest

from tests.test_sources import auth_headers, client, configure_test_jwt  # noqa: F401


@pytest.mark.parametrize("first,last", [
    ("0001-01-01T00:00:00+14:00", "0001-01-01T01:00:00+14:00"),
    ("9999-12-31T23:00:00-14:00", "9999-12-31T23:30:00-14:00"),
], ids=["below-utc-range", "above-utc-range"])
def test_task_and_event_boundary_inputs_return_422_without_changing_saved_data(first, last):
    headers = auth_headers("time-boundary-" + uuid.uuid4().hex + "@example.com")
    task_url = "/api/tasks"
    assert client.post(task_url, headers=headers, json={"title":"Invalid", "earliest_start":first,
        "latest_end":last}).status_code == 422
    task = client.post(task_url, headers=headers, json={"title":"Retained"}).json()
    assert client.patch(task_url + "/" + task["id"], headers=headers,
        json={"earliest_start":first}).status_code == 422
    assert client.get(task_url + "/" + task["id"], headers=headers).json()["earliest_start"] is None
    event_url = "/api/scheduled-events"
    assert client.post(event_url, headers=headers, json={"task_id":task["id"],
        "start_at":first, "end_at":last}).status_code == 422
    event = client.post(event_url, headers=headers, json={"task_id":task["id"],
        "start_at":"2026-11-01T10:00:00+09:00", "end_at":"2026-11-01T11:00:00+09:00"}).json()
    assert client.patch(event_url + "/" + event["id"], headers=headers,
        json={"start_at":first, "end_at":last}).status_code == 422
    assert client.get(event_url + "/" + event["id"], headers=headers).json()["start_at"] == event["start_at"]
    assert client.get("/api/calendar/registrations", headers=headers,
        params={"start_from":first, "end_before":last}).status_code == 422
