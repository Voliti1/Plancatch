"""Korean command dates, ambiguity and preview-to-existing-calendar integration."""
import uuid
from datetime import datetime, timedelta

import pytest

from app.services.natural_schedule import SEOUL, interpret
from tests.test_sources import auth_headers, client, configure_test_jwt  # noqa: F401

NOW = datetime(2026, 11, 2, 12, 0, tzinfo=SEOUL)  # Monday, independent of host timezone.


@pytest.mark.parametrize('text,kind,title,start,end', [
    ('10분 뒤 알림 테스트', 'deadline', '알림 테스트', None, '2026-11-02T12:10'),
    ('지금부터 1시간 30분 후에 20분 동안 회의', 'task', '회의', '2026-11-02T13:30', '2026-11-02T13:50'),
    ('10분뒤알림 테스트', 'deadline', '알림 테스트', None, '2026-11-02T12:10'),
    ('1시간 뒤 이발', 'deadline', '이발', None, '2026-11-02T13:00'),
    ('10분 후부터 1시간 뒤까지 알림 테스트', 'task', '알림 테스트', '2026-11-02T12:10', '2026-11-02T13:00'),
    ('두 시간 후 보고서 제출', 'deadline', '보고서 제출', None, '2026-11-02T14:00'),
    ('내일 오후 3시 회의', 'deadline', '회의', None, '2026-11-03T15:00'),
    ('내일오후3시회의', 'deadline', '회의', None, '2026-11-03T15:00'),
    ('금요일까지 보고서 제출', 'deadline', '보고서 제출', None, '2026-11-06T23:59'),
    ('금요일까지보고서 제출', 'deadline', '보고서 제출', None, '2026-11-06T23:59'),
    ('다음 주 금요일 오후 6시 지원 마감', 'deadline', '지원 마감', None, '2026-11-13T18:00'),
    ('이번주 일요일 18:00 과제 마감', 'deadline', '과제 마감', None, '2026-11-08T18:00'),
    ('다다음주 월요일 오전 10시 면접', 'deadline', '면접', None, '2026-11-16T10:00'),
    ('모레 오전 10시부터 11시 면접', 'task', '면접', '2026-11-04T10:00', '2026-11-04T11:00'),
    ('내일 오후 3시부터 4시 회의', 'task', '회의', '2026-11-03T15:00', '2026-11-03T16:00'),
    ('15시 16시 마감 준비', 'task', '마감 준비', '2026-11-02T15:00', '2026-11-02T16:00'),
    ('오늘 18:00~19:30 운동', 'task', '운동', '2026-11-02T18:00', '2026-11-02T19:30'),
    ('내일 오후 3시 반 한 시간 회의', 'task', '회의', '2026-11-03T15:30', '2026-11-03T16:30'),
    ('내일 오후3시 1시간30분 회의', 'task', '회의', '2026-11-03T15:00', '2026-11-03T16:30'),
    ('내일 오후3시30분 회의', 'deadline', '회의', None, '2026-11-03T15:30'),
    ('내일 오후3시0분 회의', 'deadline', '회의', None, '2026-11-03T15:00'),
    ('내일 18시30분부터 19시45분 회의', 'task', '회의', '2026-11-03T18:30', '2026-11-03T19:45'),
    ('내일 오후3시30분 30분 면접', 'task', '면접', '2026-11-03T15:30', '2026-11-03T16:00'),
    ('3일 후 정오 30분 점심', 'task', '점심', '2026-11-05T12:00', '2026-11-05T12:30'),
    ('2026년 12월 31일 24시 지원 마감', 'deadline', '지원 마감', None, '2027-01-01T00:00'),
    ('11.03 오후 5시 서류 마감', 'deadline', '서류 마감', None, '2026-11-03T17:00'),
    ('2026-11-03 17:00 지원 마감', 'deadline', '지원 마감', None, '2026-11-03T17:00'),
    ('2026/11/03 오전 12시 점검', 'deadline', '점검', None, '2026-11-03T00:00'),
    ('내일 밤 11시부터 새벽 1시 작업', 'task', '작업', '2026-11-03T23:00', '2026-11-04T01:00'),
    ('11월3일 오후3시~11월4일 오후4시 출장', 'task', '출장', '2026-11-03T15:00', '2026-11-04T16:00'),
    ('글피 오후 12시 미팅 등록해줘', 'deadline', '미팅', None, '2026-11-05T12:00'),
])
def test_common_expressions(text, kind, title, start, end):
    draft = interpret(text, now=NOW)
    assert (draft.kind, draft.title) == (kind, title)
    assert (draft.start_at.isoformat(timespec='minutes')[:16] if draft.start_at else None) == start
    assert (draft.end_at.isoformat(timespec='minutes')[:16] if draft.end_at else None) == end
    assert draft.reference_at == NOW and draft.timezone == 'Asia/Seoul'


@pytest.mark.parametrize('text', [
    '내일 25시 마감', '내일 18:90 마감', '내일 오후18시 마감',
    '2026년2월30일 마감', '내일3시 회의, 모레4시 약속',
    '매주 금요일 오후3시 회의', '금요일 뉴욕 시간 오후3시 회의',
    '날짜 없는 마감', '다음주 회의', '내일오후3시 0시간 회의',
    '내일 오후3시부터 오후2시 회의',
    '내일 18:999 마감', '내일 123:00 마감', '내일 18:00:30 마감',
    '내일 100시 마감', '내일18시3 마감',
    '0분 뒤 알림 테스트', '169시간 후 회의',
    '내일 3시와 10분 뒤 회의', '10분 뒤 또는 20분 뒤 회의',
    '1시간 뒤부터 10분 뒤까지 회의',
])
def test_missing_invalid_or_unsupported_fields_are_editable_not_invented(text):
    result = interpret(text, now=NOW)
    assert result.end_at is None
    assert result.notices


def test_relative_dates_use_seoul_and_report_defaults_and_past():
    late_utc = datetime.fromisoformat('2026-11-02T16:00:00+00:00')
    result = interpret('내일 오후3시 회의', now=late_utc)
    assert result.end_at.day == 4 and result.end_at.hour == 15
    assert any('23:59' in notice for notice in interpret('내일 마감', now=NOW).notices)
    assert any('이전' in notice for notice in interpret('오늘 오전9시 회의', now=NOW).notices)
    assert any('요일' in notice for notice in interpret('2026년11월3일(월) 마감', now=NOW).notices)


def test_relative_minutes_cross_midnight_in_seoul():
    reference = datetime.fromisoformat('2026-11-02T14:55:42+00:00')
    result = interpret('10분 뒤에 알림 테스트', now=reference)
    assert result.title == '알림 테스트'
    assert result.kind == 'deadline' and result.start_at is None
    assert result.end_at.isoformat() == '2026-11-03T00:05:00+09:00'
    assert all('직접' not in notice for notice in result.notices)


@pytest.mark.parametrize('phrase,reference,start,end', [
    ('3시 이발', '2026-11-02T12:00:00+09:00', None, '2026-11-02T15:00'),
    ('3시 이발', '2026-11-02T12:00:00+00:00', None, '2026-11-03T15:00'),
    ('3시 이발', '2026-11-02T15:00:01+09:00', None, '2026-11-03T15:00'),
    ('03:00 이발', '2026-11-02T21:00:00+09:00', None, '2026-11-03T03:00'),
    ('오전 3시 이발', '2026-11-02T01:00:00+09:00', None, '2026-11-02T03:00'),
    ('오늘 3시 이발', '2026-11-02T01:00:00+09:00', None, '2026-11-02T03:00'),
    ('3시부터 4시 이발', '2026-11-02T21:00:00+09:00', '2026-11-03T15:00', '2026-11-03T16:00'),
    ('3시까지 보고서 제출', '2026-11-02T21:00:00+09:00', None, '2026-11-03T15:00'),
    ('23:30부터 다음 날 새벽 1시 점검', '2026-11-02T21:00:00+09:00', '2026-11-02T23:30', '2026-11-03T01:00'),
])
def test_time_without_date_uses_next_occurrence_in_seoul(phrase, reference, start, end):
    draft = interpret(phrase, now=datetime.fromisoformat(reference))
    assert (draft.start_at.isoformat(timespec='minutes')[:16] if draft.start_at else None) == start
    assert draft.end_at.isoformat(timespec='minutes')[:16] == end
    assert all('직접' not in notice for notice in draft.notices)


def test_preview_does_not_write_and_reviewed_items_use_existing_calendar():
    auth = auth_headers('natural-' + uuid.uuid4().hex + '@example.com')
    result = client.post('/api/schedules/interpret', headers=auth, json={'text': '10분 뒤 알림 테스트'})
    assert result.status_code == 200
    relative = result.json()
    reference = datetime.fromisoformat(relative['reference_at']).replace(second=0, microsecond=0)
    assert relative['title'] == '알림 테스트'
    assert relative['kind'] == 'deadline' and relative['start_at'] is None
    assert datetime.fromisoformat(relative['end_at']) == reference + timedelta(minutes=10)
    result = client.post('/api/schedules/interpret', headers=auth, json={'text': '3시부터 4시 이발'})
    assert result.status_code == 200
    draft = result.json()
    reference = datetime.fromisoformat(draft['reference_at'])
    expected_start = reference.replace(hour=15, minute=0, second=0, microsecond=0)
    if expected_start < reference:
        expected_start += timedelta(days=1)
    assert draft['kind'] == 'task' and datetime.fromisoformat(draft['start_at']) == expected_start
    assert client.get('/api/tasks', headers=auth).json() == []
    assert client.get('/api/deadlines', headers=auth).json() == []
    assert client.get('/api/sources', headers=auth).json() == []
    task = client.post('/api/tasks', headers=auth, json={
        'title': draft['title'], 'schedule_type': 'fixed',
        'earliest_start': draft['start_at'], 'latest_end': draft['end_at'],
    })
    assert task.status_code == 201
    deadline = client.post('/api/deadlines', headers=auth, json={
        'title': 'Reviewed title', 'due_at': draft['end_at'], 'is_confirmed': True,
    })
    assert deadline.status_code == 201
    start = draft['start_at'][:10] + 'T00:00:00+09:00'
    end = draft['end_at'][:10] + 'T23:59:59+09:00'
    calendar = client.get('/api/calendar/registrations', headers=auth,
                          params={'start_from': start, 'end_before': end})
    assert calendar.status_code == 200
    assert {item['title'] for item in calendar.json()['entries']} == {'이발', 'Reviewed title'}


def test_auth_and_input_contract():
    assert client.post('/api/schedules/interpret', json={'text': '내일 회의'}).status_code == 401
    auth = auth_headers('natural-validation-' + uuid.uuid4().hex + '@example.com')
    for payload in [{'text': ''}, {'text': '  '}, {'text': 'a' * 1001}, {'text': '내일 회의', 'user_id': str(uuid.uuid4())}]:
        assert client.post('/api/schedules/interpret', headers=auth, json=payload).status_code == 422
