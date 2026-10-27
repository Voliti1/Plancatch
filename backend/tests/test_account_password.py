"""Current-password verification, owner scope and session renewal without external services."""
import uuid

import pytest

from app.core.security import create_access_token, verify_password
from app.models import User
from tests.test_auth import TestingSession, client, configure_test_jwt  # noqa: F401


def account():
    email = 'settings-' + uuid.uuid4().hex + '@example.com'
    user = client.post('/api/auth/signup', json={'email': email, 'password': 'old-password-123'}).json()
    token = client.post('/api/auth/login', json={'email': email, 'password': 'old-password-123'}).json()['access_token']
    return user, {'Authorization': 'Bearer ' + token}


def test_change_password_renews_current_session_and_revokes_bound_old_sessions():
    user, headers = account()
    other, other_headers = account()
    changed = client.post('/api/auth/password', headers=headers,
                          json={'current_password': 'old-password-123', 'new_password': 'new-password-456'})
    assert changed.status_code == 200 and changed.json()['token_type'] == 'bearer'
    assert 'password' not in changed.json() and 'password_hash' not in changed.json()
    renewed = {'Authorization': 'Bearer ' + changed.json()['access_token']}
    assert client.get('/api/auth/me', headers=renewed).json()['id'] == user['id']
    assert client.get('/api/auth/me', headers=headers).status_code == 401
    assert client.get('/api/auth/me', headers=other_headers).json()['id'] == other['id']
    assert client.post('/api/auth/login', json={'email': user['email'], 'password': 'old-password-123'}).status_code == 401
    assert client.post('/api/auth/login', json={'email': user['email'], 'password': 'new-password-456'}).status_code == 200
    with TestingSession() as db:
        saved = db.get(User, uuid.UUID(user['id']))
        assert saved.password_hash != 'new-password-456' and verify_password('new-password-456', saved.password_hash)


@pytest.mark.parametrize('current,next_password,error', [
    ('wrong-current', 'new-password-456', 'current_password_incorrect'),
    ('old-password-123', 'old-password-123', 'new_password_unchanged'),
])
def test_rejected_password_change_preserves_password_and_login(current, next_password, error):
    user, headers = account()
    changed = client.post('/api/auth/password', headers=headers,
                          json={'current_password': current, 'new_password': next_password})
    assert changed.status_code == 400 and changed.json()['detail'] == error
    assert client.get('/api/auth/me', headers=headers).status_code == 200
    assert client.post('/api/auth/login', json={'email': user['email'], 'password': 'old-password-123'}).status_code == 200


@pytest.mark.parametrize('payload', [
    {'current_password': '', 'new_password': 'new-password-456'},
    {'current_password': 'old-password-123', 'new_password': 'short'},
    {'current_password': 'old-password-123', 'new_password': 'a' * 129},
    {'current_password': 'old-password-123', 'new_password': 'new-password-456', 'user_id': str(uuid.uuid4())},
])
def test_invalid_password_input_never_updates_the_account(payload):
    _, headers = account()
    assert client.post('/api/auth/password', headers=headers, json=payload).status_code == 422
    assert client.get('/api/auth/me', headers=headers).status_code == 200


def test_password_change_requires_login_and_old_unbound_sessions_keep_their_expiry():
    user, _ = account()
    assert client.post('/api/auth/password', json={'current_password': 'old-password-123', 'new_password': 'new-password-456'}).status_code == 401
    legacy = {'Authorization': 'Bearer ' + create_access_token(user['id'])}
    # Explicit compatibility: pre-release tokens do not contain a password stamp.
    assert client.get('/api/auth/me', headers=legacy).status_code == 200
    assert client.post('/api/auth/password', headers=legacy, json={
        'current_password': 'old-password-123', 'new_password': 'new-password-456'}).status_code == 200
    assert client.get('/api/auth/me', headers=legacy).status_code == 200
