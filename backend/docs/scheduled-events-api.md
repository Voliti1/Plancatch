# Scheduled event API

Bearer authentication is required for every endpoint. Each user can access only
their own placements and link only their own tasks. Missing or inaccessible IDs
return 404. The existing scheduled_events table is reused; no migration is needed.

| Method | Path | Success |
| --- | --- | --- |
| POST | /api/scheduled-events | 201 |
| GET | /api/scheduled-events | 200 |
| GET | /api/scheduled-events/{id} | 200 |
| PATCH | /api/scheduled-events/{id} | 200 |
| DELETE | /api/scheduled-events/{id} | 204 |

Create requires task_id, start_at and end_at. Timestamps must include timezone
offsets and end_at must be later than start_at. Values are normalized to UTC.
Optional status is recommended (default), approved, or cancelled.

PATCH supports start_at, end_at and status only; null is rejected. A partial time
change is validated against the saved other endpoint. is_user_approved is derived
from status: true for approved, false for recommended/cancelled. Clients cannot
set synchronization fields or claim synced status. Editing/deleting a synced
event returns 409 until a calendar synchronization workflow is available.

List filters: task_id, status, start_from and end_before. The date range returns
events overlapping [start_from, end_before); cancelled events are included unless
a status filter is provided. Pagination uses limit (1–100, default 50) and offset
(>=0, default 0). Ordering is start_at ascending, then ID.

Responses include id, task_id, start_at, end_at, status, is_user_approved,
google_calendar_id, google_event_id, sync_error, created_at and updated_at.

This is local placement CRUD. It does not generate schedules, enforce non-overlap
or task/deadline bounds, or communicate with Google Calendar. Those rules belong
to the upcoming scheduling and calendar integration features.
