# PlanCatch backend

현재 기능·지원 제한은 [저장소 개요](../README.md)와 [main 통합 범위](docs/main-integration-20261102.md)를 참고하세요.
Google 연결/조회 외에 [명시적 일정 전송·중복 방지](docs/google-calendar-export.md)도 구현되어 있습니다.
전체 DB 구조 기준은 migration20261102_0009이며 기존 운영 DB를 자동 downgrade하지 않습니다.
[확인 후 Google 일정 수정·삭제](docs/google-calendar-changes.md)와 연결 화면의 보낸 일정 관리도 제공합니다.
POST /api/auth/password는 현재 비밀번호를 확인하고 새 해시를 저장한 뒤 현재 브라우저용 토큰을 반환합니다.
신규 로그인은 비밀번호 변경 후 이전 세션을 차단하며, 도입 전 토큰은 원래 만료까지 호환됩니다.

## Google Calendar connection

Account connection/status/disconnection is separate from event synchronization.
See [setup, API contract and frontend handoff](docs/google-calendar-connection.md).
Production activation requires HTTPS, server-only credentials and migration 0007;
the earlier one-time OAuth probe did not save a connection.

## Local setup

Create and activate a Python 3.12 virtual environment, then install the dependencies:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements-dev.txt
```

Copy the environment template before running the application:

```bash
cp .env.example .env
```

Keep real credentials in `.env`. The file is ignored by Git and must not be
committed.

Apply database migrations after configuring the DB settings:

```bash
alembic upgrade head
```

## Run

```bash
uvicorn main:app --reload
```

The health endpoint is available at `http://127.0.0.1:8000/health`.

## Account registration

Create an account with `POST /api/auth/signup`:

```json
{
  "email": "user@example.com",
  "password": "at-least-8-characters",
  "display_name": "Plan Catcher"
}
```

Passwords are stored as Argon2 hashes and are never included in API responses.

## Safety deadlines

Deadline CRUD supports optional `safety_buffer_minutes` and returns calculated
`safe_due_at` alongside the unchanged official `due_at`. No buffer is assumed
for existing records or AI-approved deadlines. See
[API rules and frontend handoff](docs/safe-deadlines-api.md).

Set `JWT_SECRET_KEY` in `.env`, then sign in with `POST /api/auth/login`:

```json
{
  "email": "user@example.com",
  "password": "at-least-8-characters"
}
```

Send the returned token as `Authorization: Bearer <token>` when calling
`GET /api/auth/me`.

## Test

```bash
pytest
```
