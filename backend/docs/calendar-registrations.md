# 기존 등록 결과의 캘린더 표시

- `GET /api/calendar/registrations?start_from=<offset ISO>&end_before=<offset ISO>`
- 로그인한 본인의 마감일과 미배치 고정 일정을 읽기 전용으로 반환한다. 0일 초과 62일 이하.
- `entries`: id, kind(deadline/fixed_task), title, start_at, end_at(null은 마감 시점), is_confirmed, is_completed.
- 마감일은 공식 due_at의 날짜에 표시한다. 자료 분석/승인으로 Deadline이 저장된 뒤 표시되며,
  원본 Source만 저장했거나 AI 후보만 있는 상태는 표시하지 않는다. 안전 마감일은 별도 일정을 만들지 않는다.
- 고정 Task는 earliest_start/latest_end가 모두 있을 때 그 구간을 표시한다. 유동 작업의 가능 기간은 표시하지 않는다.
- 해당 Task의 ScheduledEvent가 하나라도 있으면(취소 포함) 미배치 고정 일정 투영을 제외한다.
  실제 배치는 기존 /api/scheduled-events로 조회한다. 목록에는 task_title을 함께 반환하여 제목 N+1 요청을 줄인다.
- 마지막 배치를 삭제해도 Task 자체는 유지되므로, 날짜가 있는 고정 Task는 원래 등록 시간으로 다시 표시된다.
  일정 자체를 없애려면 기존 Task 삭제를 사용한다. 투영은 DB 배치 행을 자동 생성하지 않는다.
- 기간은 반개구간이다. 종료가 조회 시작과 같은 일정은 제외, 마감이 조회 시작과 같으면 포함한다.
- 종류별 1,000건 초과 시 has_more=true이며 주간 보기로 범위를 줄인다. Cache-Control:no-store.
- 기존 등록/수정/삭제 API와 DB 구조는 유지한다. 새 배치/Task/Deadline 행을 생성하거나 Google에 전송하지 않는다.
