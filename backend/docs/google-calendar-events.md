# 구글 기본 캘린더 조회

- 인증된 GET /api/integrations/google-calendar/events?start_from=...&end_before=...
- 명시적 조회 선택 시만 호출, 본인 연결의 primary 캘린더. 기간0초 초과/최대62일, timezone 필수.
- events: id/title/start_at/end_at 또는 start_date/end_date. 종일 일정 end_date는 포함하지 않는다.
- 반복 일정은 구글에서 인스턴스로 펼친다. 250건씩 다음 페이지를 자동 조회한다.
  짧거나 빈 페이지에도 다음 표시가 있으면 이어서 읽으며 조회 조건은 유지한다.
  최대 8페이지·원본 2,000건, 페이지 사이에는 전체 12초 예산을 확인한다.
  취소·비정상 항목도 원본 개수 한도에 포함한다. 같은 ID는 첫 결과만 유지한다.
  반복/잘못된 페이지 표시, 한도 도달, 두 번째 이후 페이지 오류는 앞서 읽은 결과와
  has_more=true를 반환한다. 파싱 실패·중복은 skipped_count로도 알린다.
- 제목·시각만 반환. 설명/참석자/Google 페이지 토큰/접근 토큰은 반환·로그·캐시·DB 복제하지 않는다.
- 기존 owned scope 사용. 서버에서 암호화 refresh token을 복호화하여 access token을 요청한다.
  회전 refresh token을 받으면 Google 일정 읽기가 실패해도 갱신된 암호문을 유지한다.
- 사용자 행 잠금으로 연결/해제와 토큰 회전 저장을 직렬화한다. 시작된 읽기 응답은 연결 해제 후
  도착할 수 있으나 구글 일정 쓰기를 수행하지 않는다. UI는 표시 해제/이탈 후 늦은 응답을 숨긴다.
- 권한/만료/미연결409, 기간/입력422, provider 접근/응답 문제502, 일시 제한503. 오류를 빈 목록으로 대체하지 않는다.
- 고정 Google HTTPS endpoint만 허용, redirect 금지/페이지 응답1MiB 한도.
  각 페이지 연결/읽기 timeout은 남은 예산과 10초 중 작은 값이다. 절대 실행시간 타이머는 아니다.
  OAuth refresh도10초 한도. 첫 페이지 실패와 어느 페이지에서든 권한 상실은 기존 오류를 반환한다.
  화면 요청은30초 한도. 접근 토큰 영구 저장/자동 폴링/이벤트 쓰기 없음.
- DB migration/새 키/권한 범위 확대 없음. Google에서 작성한 개인 일정은 조회 전용이다.
- 화면은 현재 기간 결과만 메모리에 보관해 같은 기간의 날짜 선택 때 재조회하지 않는다.
  새로고침/다른 기간 이동/다시 표시 선택 때 조회한다. 영구 브라우저 저장은 하지 않는다.

이 읽기 경로는 캘린더 표시·겹침 검사·자동 배치에서 함께 사용한다. 검사가 불완전하면
겹침 없음으로 확정하지 않고 자동 배치 승인은 막는다. 기존 Google 자동 전송은 별도 경로다.

공식: [일정 조회](https://developers.google.com/workspace/calendar/api/v3/reference/events/list),
[페이지 조회](https://developers.google.com/workspace/calendar/api/guides/pagination).
