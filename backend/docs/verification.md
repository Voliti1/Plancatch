# Backend verification

Local regression suite:

```bash
python -m pytest -q
python -m ruff check app tests
```

SQLite tests enable foreign keys to verify SET NULL and CASCADE rules. PostgreSQL
tests are opt-in and are skipped by default. The suite uses non-production JWT
keys and synthetic accounts. It does not measure load or validate browser CORS.

PostgreSQL check on EC2, after this branch has been merged and pulled:

```bash
cd /home/ec2-user/Plancatch/backend
source ../.venv312/bin/activate
python -m pip install -r requirements-dev.txt
PLANCATCH_TEST_POSTGRES=1 python -m pytest tests/test_postgresql.py -q --tb=short
```

This uses the configured DB connection but creates all tables and synthetic data
in a uniquely named temporary schema. DDL and data share one transaction which
is rolled back after the test, including on failure. It requires CREATE SCHEMA
permission. Existing application tables are not modified. It verifies model DDL,
timezone preservation, check/FK constraints and delete actions on PostgreSQL.
It does not verify existing public schema migrations or run the full API suite
against PostgreSQL. Do not paste credentials or connection strings in reports.

EC2 API smoke check (existing TOKEN must be a current login token):

```bash
TASK_ID=$(curl -fsS -X POST http://127.0.0.1/api/tasks -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"title":"Schedule verification","estimated_minutes":60}' | python -c "import sys,json; print(json.load(sys.stdin)['id'])")
EVENT_ID=$(curl -fsS -X POST http://127.0.0.1/api/scheduled-events -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "{\"task_id\":\"$TASK_ID\",\"start_at\":\"2026-09-20T09:00:00+09:00\",\"end_at\":\"2026-09-20T10:00:00+09:00\"}" | python -c "import sys,json; print(json.load(sys.stdin)['id'])")
curl -fsS -X PATCH "http://127.0.0.1/api/scheduled-events/$EVENT_ID" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"status":"approved"}' | python -m json.tool
```

Expected: status approved, is_user_approved true. These commands intentionally
create a test task and event in the application. After inspection, remove only
those newly created records:

```bash
curl -fsS -X DELETE "http://127.0.0.1/api/scheduled-events/$EVENT_ID" -H "Authorization: Bearer $TOKEN"
curl -fsS -X DELETE "http://127.0.0.1/api/tasks/$TASK_ID" -H "Authorization: Bearer $TOKEN"
```
