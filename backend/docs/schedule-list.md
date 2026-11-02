# 일정 통합 조회

`GET /api/schedules`는 로그인한 사용자의 마감일과 할 일을 함께 조회한다.
기존 생성·수정·삭제 API와 DB 구조는 유지한다. 조회로 Google 전송 작업을 만들지 않는다.

- `q`: 제목 부분 검색, 앞뒤 공백 제거, 최대 255자. `%`, `_`도 일반 문자로 검색한다.
- `include_deadlines`, `include_tasks`: 기본 true. 둘 다 false이면 빈 목록이다.
- `offset`: 기본 0, 0 이상. `limit`: 기본 50, 1~100.
- 응답: `{entries: [{kind: "deadline" | "task", item: 기존 응답}], has_more: boolean}`.
- 마감일은 공식 마감 시각, 할 일은 가능 시작 시각(없으면 종료 시각)으로 정렬한다.
  시간 미정은 마지막이며, 동률은 종류와 ID 순서로 안정적으로 정렬한다.
  날짜별 캘린더 배치는 기존 `/api/calendar/registrations`와 `/api/scheduled-events`로 조회한다.
- DB에서 두 종류를 합쳐 페이지를 나눈다. 각 종류의 첫 페이지만 합치는 방식이 아니다.
- 종류와 ID를 함께 식별자로 사용한다. 같은 ID가 두 테이블에 있어도 항목이 충돌하지 않는다.
- 검색·정렬·상세 조회 모두 소유 계정을 제한하며 응답은 `Cache-Control: no-store`다.
- 기존 `/api/deadlines`, `/api/tasks`, `/api/schedules/interpret` 계약은 그대로다.

검사: `tests/test_schedules.py`. PostgreSQL에서도 별도 트랜잭션의 임시 구조로
혼합 페이지, 동일 UUID, 문자 검색, 소유 분리를 확인하고 전부 되돌린다.
