# Task API

All endpoints require `Authorization: Bearer <access_token>`. Records are scoped
to the authenticated user; inaccessible records and deadline links return 404.

| Method | Path | Result |
| --- | --- | --- |
| POST | /api/tasks | Create, 201 |
| GET | /api/tasks | List, 200 |
| GET | /api/tasks/{id} | Read, 200 |
| PATCH | /api/tasks/{id} | Partial update, 200 |
| DELETE | /api/tasks/{id} | Delete, 204 |

Example create body:

```json
{
  "title": "Draft application",
  "estimated_minutes": 60,
  "priority": 3,
  "schedule_type": "flexible",
  "earliest_start": "2026-09-20T09:00:00+09:00",
  "latest_end": "2026-09-29T18:00:00+09:00"
}
```

`deadline_id` is an optional owned deadline UUID. `description` is optional.
Title is trimmed and must contain 1–255 characters. Estimated minutes must be
positive when supplied; priority is 1–5 (default 3). Schedule type is `fixed`
or `flexible` (default). These endpoints store tasks; they do not allocate calendar
slots. Time bounds are optional, require timezone offsets, and must satisfy
earliest_start < latest_end when both exist. PATCH validates the resulting window
including saved values. PostgreSQL may return timestamps normalized to UTC.

Set `is_completed: true` to complete a task; the server records `completed_at`.
Repeated completion preserves that timestamp. Setting false clears it.
Clients cannot set completed_at directly.

PATCH can clear deadline_id, description, estimated_minutes and time bounds with
null. Required fields title, priority, schedule_type and is_completed reject null.
Unknown input fields are rejected with 422.

List filters: `deadline_id`, `is_completed`, `schedule_type`; pagination:
`limit` (1–100, default 50), `offset` (>=0, default 0). Results are newest first.
Responses include input fields plus id, completed_at, created_at and updated_at.

The existing tasks table is reused; this change requires no database migration.
