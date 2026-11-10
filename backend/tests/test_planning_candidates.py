"""Date-based candidate browsing is owned, searchable and paginated before display."""
import uuid
from datetime import UTC, datetime

from app.models import Task
from tests.test_auth import TestingSession
from tests.test_auto_schedule import owner, task
from tests.test_sources import client, configure_test_jwt  # noqa: F401


def test_candidates_use_completion_limit_then_start_with_undated_last():
    auth = owner()
    other = owner()
    task(other, title="다른 사람", latest_end="2026-01-01T00:00:00Z")
    undated = task(auth, title="날짜 없는 일")
    start = task(auth, title="시작 가능일", earliest_start="2026-11-12T00:00:00Z")
    due = client.post('/api/deadlines', headers=auth, json={
        'title': '연결 마감', 'due_at': '2026-11-11T15:00:00+09:00'
    }).json()
    linked = task(auth, title="연결된 마감", deadline_id=due['id'], latest_end="2026-11-13T00:00:00Z")
    late = task(auth, title="나 준비", latest_end="2026-11-11T14:00:00+09:00")
    early = task(auth, title="가 준비", latest_end="2026-11-11T14:00:00+09:00")
    response = client.get('/api/scheduling/tasks', headers=auth)
    data = response.json()
    assert response.headers['Cache-Control'] == 'no-store'
    assert [r['id'] for r in data['entries']] == [early['id'], late['id'], linked['id'], start['id'], undated['id']]
    assert data['entries'][2]['sort_at'].startswith('2026-11-11T06:00:00')
    assert data['entries'][-1]['sort_at'] is None
    assert not data['has_more'] and data['next_offset'] is None
    assert [r['id'] for r in client.get('/api/scheduling/tasks', headers=auth, params={'q': '가 준비'}).json()['entries']] == [early['id']]
    assert client.get('/api/scheduling/tasks', headers=auth, params={'offset': -1}).status_code == 422


def test_date_sort_applies_before_pagination_and_all_pages_are_reachable():
    auth = owner()
    seed = task(auth, title="날짜 미정")
    with TestingSession() as db:
        user_id = db.get(Task, uuid.UUID(seed['id'])).user_id
        db.add_all([Task(user_id=user_id, title=f"준비 {i:03d}", schedule_type='flexible',
                        estimated_minutes=60, latest_end=datetime(2026, 11, 11, tzinfo=UTC)) for i in range(101)])
        db.commit()
    first = client.get('/api/scheduling/tasks', headers=auth).json()
    assert len(first['entries']) == 100 and first['has_more'] and first['next_offset'] == 100
    assert first['entries'][0]['title'] == '준비 000'
    second = client.get('/api/scheduling/tasks', headers=auth, params={'offset': first['next_offset']}).json()
    assert [r['title'] for r in second['entries']] == ['준비 100', '날짜 미정']
    assert not second['has_more']
    assert not ({r['id'] for r in first['entries']} & {r['id'] for r in second['entries']})
