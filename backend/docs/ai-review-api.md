# AI deadline proposal and review API

This stage does not include frontend screens, task generation, safety deadlines,
automatic scheduling or Google Calendar synchronization. No deadlines are created
until the authenticated owner approves a result or explicitly opts into the separate
single-candidate automatic registration endpoint documented below. No production mock provider exists.

Safety deadlines are available in a separate subsequent stage through existing
Deadline CRUD: see [safe-deadlines-api.md](safe-deadlines-api.md). AI approval does
not choose a safety buffer; the authenticated user configures it separately.

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
guarantee of factual accuracy. Ambiguous results require human review; the narrowly
scoped automatic registration flow below requires separate explicit opt-in.

This MVP uses BackgroundTasks rather than a durable queue. Process restart can
leave jobs in processing. Multi-process capacity and per-user quotas, cancellation,
restart recovery, retention and external-AI consent auditing need follow-up work.
Schema migration 20260930_0005 only adds the analyses table and indexes. Keep user
data during rollback: do not automatically downgrade/drop this table. Flag-001
code remains compatible with the additional table.
# Opt-in automatic registration

Dashboard automatic registration uses `POST /api/ai-analyses/{id}/auto-register`
with `revision`, the saved Source `title`, and `confirm_auto_registration: true`.
Only an unedited revision-1 analysis with one selected, explicitly dated candidate and
no warnings may be registered. Otherwise HTTP 422 `auto_registration_requires_review`
leaves it ready for the existing manual review workflow. Title replacement and approval
are atomic; approved retries return the original deadline IDs. Ownership, source hash/state
and revision checks remain enforced. No schema migration, task/event creation or calendar sync.

## 한국 시간 기본 처리 정책 (2026-10-06)

- 원문에 연도·날짜·시간이 모두 있고 시간대만 없으면 서비스 기본값인
  `Asia/Seoul` (`UTC+09:00`)을 적용합니다. 시간대 누락만으로 검토 경고를 만들지 않습니다.
- 예: `2026-10-29T23:59` → `2026-10-29T23:59:00+09:00` (UTC `2026-10-29T14:59:00Z`).
- 원문에 `Z`, `-04:00`, `UTC`, 현지 시간 등 다른 시간대가 명시되면 이를 존중합니다.
  API는 시간대가 있는 일시를 반환하고 프론트엔드는 기존처럼 한국 시간으로 표시합니다.
- 정확한 원문 근거에 완전한 ISO 일시가 하나 있으면 서버가 기본 시간대 적용을 검증합니다.
  원문과 AI 날짜·시간/명시된 오프셋이 충돌하면 날짜를 비우고 검토 경고를 유지합니다.
  여러 일시 중 하나를 임의 선택하거나 연도·시간을 만들어 넣지 않습니다.
- 날짜만 있는 구조화 자료는 기존처럼 시간 확인이 필요합니다. 다른 AI 경고, 여러 후보,
  원문 해시·소유권·수정 버전·외부 AI 전송 동의·자동 등록 동의·중복 방지 검증은 유지합니다.
- 이미 저장된 분석/마감일/사용자 데이터는 변경하지 않습니다. 기존 자료를 새로 분석하면
  새 정책이 적용됩니다. 과거의 시간대 누락 안내 문구도 새 분석에서 지원합니다.
  완전한 ISO 근거로 기본 시간대를 검증한 경우에만 정확히 알려진 기본값 적용 안내 문구를
  검토 경고에서 제외합니다. 알 수 없는 경고나 날짜·시간 누락/충돌 안내를 일괄 삭제하지 않습니다.
- 요청·응답 형식과 DB 구조는 바뀌지 않습니다. 수동 후보 수정 API는 계속 명시적 시간대가
  있는 일시만 받습니다. 프론트엔드 재배포나 보안 그룹 변경은 필요하지 않습니다.
