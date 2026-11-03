# 일정별 구글 캘린더 알림

마감일·할 일에 `google_reminders`를 저장한다. 알림은 Google 계정 연결 후 실제 Google 일정이 생성/수정될 때 적용한다.
유동 작업의 가능 기간만으로는 알림을 전송하지 않으며, 기존 확정 배치가 있으면 연결된 할 일의 설정을 사용한다.

- `default`: 해당 사용자의 Google Calendar 기본 알림 사용.
- `none`: 알림 없음.
- `custom`: `overrides`에 `method`(popup/email)와 정수 `minutes`(0~40320)를 지정. 1~5개, 같은 방식/시간 중복 금지.
- 기존 DB의 NULL은 기존 Google 알림을 관리하지 않는 상태다. 일반 수정에서는 해당 필드를 생략하고 Google 알림을 그대로 보존한다. PATCH 명시적 null은 거부한다.

사용자 선택에 따라 새 항목은 알림 없이 시작한다. 구글 기본 알림이나 직접 설정을 선택해야 알림을 사용한다. 마감일은 마감 시각, 할 일·배치는 시작 시각을 기준으로 한다.
알림 시각은 Google이 처리하며 플랜캐치가 별도 이메일 발송이나 브라우저 알림 권한 요청을 수행하지 않는다.
전용 모바일 앱·모바일 권한 처리는 이번 범위에 포함하지 않는다.

Google 요청의 `reminders`를 명시적으로 관리할 때는 GET 결과에서 의미상 같은지 확인한다. 목록 순서는 무관하고 알림 없음의 생략된 빈 목록을 허용한다.
Google에서 직접 바뀐 알림은 다른 필드처럼 충돌로 처리하여 덮어쓰지 않는다. 변경 의도·재시도·응답 유실 복구는 기존 자동 동기화를 사용한다.
관리하지 않는 메모·알림은 유지한다. 기존 항목을 일괄 큐에 넣지 않으며 새 연결에서 기존 자료를 자동으로 전체 전송하지 않는다.

DB11은 tasks/deadlines에 nullable JSON 열을 하나씩 추가하며 기본값·데이터 갱신·Google 요청을 포함하지 않는다.
ORM/API의 기본값은 신규 생성에만 사용한다. 사용자 데이터나 운영 DB를 자동 downgrade하지 않는다.

계약: [Google reminders](https://developers.google.com/workspace/calendar/api/concepts/reminders),
[Events reminder limits](https://developers.google.com/workspace/calendar/api/v3/reference/events#reminders).
