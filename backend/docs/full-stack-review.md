# Full-stack review — 2026-09-16

Base: e568fe4 (frontend-base merged). Fix branch: fix/full-stack-review.

## Corrections

- Added explicit CORS origin configuration for frontend-to-API requests.
- Capped task estimated_minutes at PostgreSQL INTEGER range on create/update.
- Normalized task time bounds to UTC before persistence, avoiding inconsistent
  partial updates in SQLite tests when input contains a Korean timezone offset.
- Blocked task deletion when a linked calendar event is synced, preventing the
  parent-delete cascade from bypassing the event deletion guard.
- Added ID tie-breakers to source/deadline pagination ordering.
- Resource requests now expose loading instead of stale data/errors when the
  request identity changes or a retry starts; old results remain ignored.
- Keyed deadline detail by ID to isolate form state across detail navigation.
- Preserved deadline seconds/fractions when editing fields other than the time.
- Invalidated old auth-restore requests when a new login begins; cancelled login
  responses cannot restore a logged-out session or clear a newer token.
- Browser tests now wait for detail navigation before editing the newly created
  record, avoiding accidental edits to the outgoing creation form.

## Deployment configuration

Set backend .env CORS_ORIGINS to an explicit JSON array of frontend origins, e.g.
`CORS_ORIGINS=["http://localhost:3000","http://127.0.0.1:3000"]`, then restart
plancatch. Include the actual deployed frontend origin when known. The default
empty list allows no cross-origin browser access. No database migration required.

Set frontend NEXT_PUBLIC_API_BASE_URL to the externally reachable API base URL
before building. An HTTPS frontend requires an HTTPS API. Local addresses in the
example are origins on the developer's browser, not EC2 loopback endpoints.

## Verification boundaries

Local results: backend 52 passed, 1 PostgreSQL opt-in test skipped; Ruff passed.
Frontend ESLint and TypeScript checks passed. Production build succeeded as the
Playwright test server setup; all 12 desktop/mobile browser cases passed.
The Windows test runner remained in web-server teardown after reporting all
cases successful and was interrupted; a clean runner exit was not verified.

Backend regression suite uses SQLite; PostgreSQL opt-in test requires EC2/RDS and
is not rerun by this local review. Frontend browser tests use mocked API responses
and cover PC/mobile flows, not live EC2 integration. Production Nginx/TLS settings
and actual cross-origin browser-to-RDS requests require deployment verification.
The PostgreSQL model test is not an Alembic migration test. Automatic scheduling,
Google synchronization and unimplemented UI pages are outside these bug fixes.
