# AI deadline proposal and review API

This stage does not include frontend screens, task generation, safety deadlines,
automatic scheduling or Google Calendar synchronization. No deadlines are created
until the authenticated owner approves a result. No production mock provider exists.

## Flow

1. Store a source and call existing `POST /api/sources/{id}/analyze` for text extraction.
2. When source status is `extracted`, POST `/api/sources/{id}/ai-analyses`
   with `{"allow_external_ai":true}`. The entire extracted text (maximum 40,000
   characters) will be sent to Google Gemini. The frontend must explain this
   disclosure and obtain consent before setting the field. There is no silent truncation.
3. 202 returns a separate AnalysisResponse in `processing`. Poll
   `GET /api/ai-analyses/{id}`. States: processing, ready, failed, approved, rejected.
   Source processing_status continues to describe extraction only.
4. Display input_text beside candidates and warnings. Each candidate has id, title,
   due_at (offset-aware ISO8601 or null), description, exact evidence_text,
   confidence (advisory, not calibrated), selected. Ambiguous dates are unselected.
5. PATCH `/api/ai-analyses/{id}` with current revision and ALL candidates, containing
   only id/title/due_at/description/selected. Evidence and confidence are immutable.
   Use selected=false to exclude. The revision increments on each successful edit.
6. POST `/api/ai-analyses/{id}/approve` with `{"revision":2}` using the current
   revision. Creates confirmed Deadline records only for selected candidates.
   Response includes approved_deadline_ids. The operation is transactional and
   retries after approval return the same IDs without duplicate creation.
   Approval does not create Task or ScheduledEvent records.
7. POST `/api/ai-analyses/{id}/reject` with current revision discards the entire result
   without creating deadlines. Lists: GET `/api/sources/{id}/ai-analyses?limit=10&offset=0`.

All routes require login and ownership. Other users receive 404. A stale revision,
concurrent run, non-ready review or changed source blocks approval with 409. An empty
selection or selected candidate without a due date returns 422. AI provider outputs
must pass Pydantic validation and evidence must occur in the input snapshot.
Original source edits do not delete analysis history; approval checks the current
extracted text hash. Source deletion cascades its analysis history, but existing
approved deadlines remain under the existing SET NULL policy.

## Provider configuration and controls

Set `GEMINI_API_KEY` and `GEMINI_MODEL` in the EC2 backend environment (never in
NEXT_PUBLIC variables, committed files or chat). Choose a currently supported
model that supports structured JSON output. Restart only the backend afterward.
Missing key returns 503 ai_not_configured; absent/invalid model returns 503
ai_model_not_configured. No result/job is created on configuration failure.
The adapter follows the official structured-output REST contract:
https://ai.google.dev/gemini-api/docs/generate-content/structured-output
Live adapter verification succeeded on 2026-09-30 using gemini-3.5-flash-lite
and synthetic source text. Model-list visibility alone does not imply generation
access: gemini-2.5-flash-lite was listed but rejected generation for a new account.
REST responseFormat.text.mimeType must use the APPLICATION_JSON enum. A flat,
basic wire schema is used for compatibility; Pydantic applies stricter validation
to the result afterward. Reference: https://ai.google.dev/api/generate-content

Transport uses a fixed HTTPS host, key header, no cookies/proxy environment or tools.
Model names cannot change the host/path. Limit: 1 job/process, 30 proposals,
2 MB provider response, 30-second socket timeout and 45-second HTTP read budget.
There are no automatic retries that could multiply cost. Full capacity returns 429.
Provider errors are persisted as safe codes, not raw responses or exception strings.
Embedded source instructions are treated as untrusted text. Validation is not a
guarantee of factual accuracy; the human review step is mandatory.

This MVP uses BackgroundTasks rather than a durable queue. Process restart can
leave jobs in processing. Multi-process capacity and per-user quotas, cancellation,
restart recovery, retention and external-AI consent auditing need follow-up work.
Schema migration 20260930_0005 only adds the analyses table and indexes. Keep user
data during rollback: do not automatically downgrade/drop this table. Flag-001
code remains compatible with the additional table.
