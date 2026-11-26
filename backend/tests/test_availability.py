"""Account isolation, date overrides and approval-time invalidation of saved hours."""
import importlib.util
import uuid
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, delete, inspect, select

from app.db.base import Base
from app.models import AvailabilityProfile, User
from tests.test_auth import TestingSession
from tests.test_auto_schedule import (  # noqa: F401
    approve,
    clock,
    events,
    fixed,
    owner,
    preview,
    task,
)
from tests.test_google_auto_sync import automatic, setup  # noqa: F401
from tests.test_sources import client, configure_test_jwt  # noqa: F401

PATH = '/api/scheduling/availability'


def read(auth):
    result = client.get(PATH, headers=auth)
    assert result.status_code == 200 and result.headers['cache-control'] == 'no-store'
    return result.json()


def put(auth, **changes):
    return client.put(PATH, headers=auth, json={**read(auth), **changes})


def hours(start, end):
    return {'start_minutes': start, 'end_minutes': end}


def test_defaults_are_not_persisted_and_users_cannot_read_or_change_each_other():
    a, b = owner(), owner()
    defaults = read(a)
    assert defaults['revision'] == 0 and defaults['timezone'] == 'Asia/Seoul'
    assert defaults['weekly'][0]['intervals'] == [hours(540, 1080)]
    assert defaults['weekly'][6]['intervals'] == []
    saved = put(a, weekly=[{'weekday': 0, 'intervals': [hours(600, 660)]}])
    assert saved.status_code == 200 and saved.json()['revision'] == 1
    assert read(b) == defaults
    assert client.get(PATH).status_code == 401
    assert put(a, user_id='other-user').status_code == 422
    assert read(a)['revision'] == 1


def test_concurrent_edits_reject_stale_revision_without_overwriting():
    auth = owner(); original = read(auth)
    assert put(auth, weekly=[]).status_code == 200
    stale = client.put(PATH, headers=auth, json={**original, 'exceptions': [{'date': '2026-11-16', 'intervals': []}]})
    assert stale.status_code == 409
    assert read(auth)['exceptions'] == [] and read(auth)['revision'] == 1


def test_weekly_rest_days_are_distinct_from_unspecified_without_changing_windows():
    auth = owner()
    assert put(auth, weekly=[{'weekday': 0, 'intervals': [], 'rest_day': True}]).status_code == 200
    result = read(auth)
    assert result['weekly'][0] == {'weekday': 0, 'intervals': [], 'rest_day': True}
    assert result['weekly'][1] == {'weekday': 1, 'intervals': []}
    assert put(auth, weekly=[
        {'weekday': 0, 'intervals': [hours(540, 600)], 'rest_day': True}
    ]).status_code == 422
    assert read(auth) == result


@pytest.mark.parametrize('change', [
    {'weekly': [{'weekday': True, 'intervals': []}]},
    {'weekly': [{'weekday': 0, 'intervals': []}]*2},
    {'weekly': [{'weekday': 7, 'intervals': []}]},
    {'weekly': [{'weekday': 0, 'intervals': [hours(600, 540)]}]},
    {'weekly': [{'weekday': 0, 'intervals': [hours(540, 660), hours(600, 720)]}]},
    {'weekly': [{'weekday': 0, 'intervals': [hours(-1, 600)]}]},
    {'weekly': [{'weekday': 0, 'intervals': [hours(0, 1441)]}]},
    {'weekly': [{'weekday': 0, 'intervals': [hours(540.1, 600)]}]},
    {'weekly': [{'weekday': 0, 'intervals': [hours(540, 600)]*9}]},
    {'exceptions': [{'date': '2026-11-16', 'intervals': []}]*2},
    {'exceptions': [{'date': '2026-02-30', 'intervals': []}]},
    {'exceptions': [{'date': '2026-11-16T00:00:00Z', 'intervals': []}]},
    {'exceptions': [{'date': 1794783600, 'intervals': []}]},
    {'timezone': 'UTC'}, {'revision': True},
])
def test_invalid_hours_never_replace_saved_settings(change):
    auth = owner(); previous = read(auth)
    result = put(auth, **change)
    assert result.status_code == 422, result.text
    assert read(auth) == previous


def test_split_windows_and_date_overrides_control_actual_proposals_and_approval():
    auth = owner()
    put(auth, weekly=[{'weekday': 0, 'intervals': [hours(780, 840), hours(540, 600)]}])
    item = task(auth)
    fixed(auth, start='2026-11-16T09:00:00+09:00', end='2026-11-16T09:30:00+09:00')
    plan = preview(auth, [item], use_saved_availability=True, include_google=False).json()
    assert plan['blocks'] == [] and plan['details']['unplaced']
    # Date-specific hours replace (rather than extend) the weekly windows.
    put(auth, exceptions=[{'date': '2026-11-16', 'intervals': [hours(840, 960)]}])
    plan = preview(auth, [item], use_saved_availability=True, include_google=False).json()
    assert plan['blocks'][0]['start_at'] == '2026-11-16T05:00:00+00:00'
    assert plan['details']['use_saved_availability'] and plan['details']['availability_revision'] == 2
    assert 'use_saved_availability' not in plan['request']  # Compatible rollback format.
    edited = [{k: block[k] for k in ('id', 'start_at', 'end_at')} for block in plan['blocks']]
    edited[0].update(start_at='2026-11-16T04:00:00+00:00', end_at='2026-11-16T05:00:00+00:00')
    assert approve(auth, plan, edited).status_code == 422
    assert not events(auth)
    approved = approve(auth, plan)
    assert approved.status_code == 200, approved.text
    assert len(events(auth)) == 2
    assert approve(auth, plan).json()['approved_event_ids'] == approved.json()['approved_event_ids']


def test_saved_change_invalidates_pending_plan_but_not_already_approved_receipt():
    auth = owner(); item = task(auth)
    plan = preview(auth, [item], use_saved_availability=True, include_google=False).json()
    assert plan['blocks']
    put(auth, weekly=[])
    assert approve(auth, plan).status_code == 409 and not events(auth)
    # Opt-out requests keep the original per-preview settings and are not affected.
    custom = preview(auth, [item], include_google=False).json()
    put(auth, exceptions=[{'date': '2026-11-16', 'intervals': []}])
    result = approve(auth, custom)
    assert result.status_code == 200
    put(auth, weekly=[])
    assert approve(auth, custom).json()['approved_event_ids'] == result.json()['approved_event_ids']


def test_closed_day_and_sunday_midnight_override_apply_in_seoul_not_utc():
    auth = owner(); item = task(auth, estimated_minutes=60)
    put(auth, exceptions=[{'date': '2026-11-16', 'intervals': []}])
    assert preview(auth, [item], use_saved_availability=True, include_google=False).json()['blocks'] == []
    put(auth, weekly=[], exceptions=[{'date': '2026-11-15', 'intervals': [hours(1380, 1440)]}])
    plan = preview(auth, [item], use_saved_availability=True, include_google=False,
        start_at='2026-11-15T00:00:00+09:00', end_at='2026-11-16T00:00:00+09:00').json()
    assert plan['blocks'][0]['start_at'] == '2026-11-15T14:00:00+00:00'
    assert plan['blocks'][0]['end_at'] == '2026-11-15T15:00:00+00:00'
    assert approve(auth, plan).status_code == 200


def test_changing_another_accounts_hours_does_not_invalidate_plan():
    a, b = owner(), owner(); item = task(a)
    plan = preview(a, [item], use_saved_availability=True, include_google=False).json()
    put(b, weekly=[])
    assert approve(a, plan).status_code == 200


def test_touching_intervals_form_continuous_time_instead_of_losing_short_fragments():
    auth = owner(); item = task(auth, estimated_minutes=60)
    put(auth, weekly=[{'weekday': 0, 'intervals': [hours(540, 550), hours(550, 600)]}])
    plan = preview(auth, [item], use_saved_availability=True, include_google=False).json()
    assert len(plan['blocks']) == 1
    assert plan['blocks'][0]['start_at'] == '2026-11-16T00:00:00+00:00'
    assert plan['blocks'][0]['end_at'] == '2026-11-16T01:00:00+00:00'
    assert approve(auth, plan).status_code == 200


def test_profile_removed_with_deleted_account_and_migration_preserves_other_tables():
    auth = owner(); put(auth, weekly=[])
    user_id = uuid.UUID(client.get('/api/auth/me', headers=auth).json()['id'])
    with TestingSession() as db:
        row = db.get(AvailabilityProfile, user_id)
        assert row is not None
        db.execute(delete(User).where(User.id == user_id)); db.commit()
        assert db.scalar(select(AvailabilityProfile.user_id).where(AvailabilityProfile.user_id == user_id)) is None
    engine = create_engine('sqlite://')
    try:
        Base.metadata.create_all(engine)
        spec = importlib.util.spec_from_file_location('availability_migration', Path(__file__).parents[1] / 'migrations/versions/20261117_0017_availability.py')
        migration = importlib.util.module_from_spec(spec); spec.loader.exec_module(migration)
        with engine.begin() as conn:
            before = set(inspect(conn).get_table_names())
            with Operations.context(MigrationContext.configure(conn)):
                migration.downgrade()
                assert set(inspect(conn).get_table_names()) == before - {'availability_profiles'}
                migration.upgrade()
            assert set(inspect(conn).get_table_names()) == before
            assert inspect(conn).get_foreign_keys('availability_profiles')[0]['options']['ondelete'] == 'CASCADE'
    finally:
        engine.dispose()
