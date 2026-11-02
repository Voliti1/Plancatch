# Google에 보낸 일정 수정·삭제

플랜캐치에서 현재 연결된 Google 기본 캘린더로 보낸 일정만 관리합니다. 로컬 저장이나 미리보기만으로 Google 일정이 바뀌지 않습니다. 자동·양방향 동기화는 포함하지 않습니다.

## 사용 순서

1. 마감일·고정 할 일·확정 배치의 상세 화면에서 제목·시간을 수정하고 저장합니다.
2. Google 전송 미리보기 → Google 수정 미리보기에서 이전/변경 내용을 비교합니다.
3. 직접 확인하면 같은 Google 일정의 제목·시작·종료만 바뀝니다. Google에서 추가한 메모·알림은 유지합니다.
4. Google 삭제 미리보기 → 직접 확인은 Google 사본과 그 사본의 메모·알림을 삭제합니다. 플랜캐치 자료는 유지합니다.

연결 화면의 ‘보낸 일정 관리’에서는 이전 버전에서 로컬 자료가 먼저 삭제된 사본도 정리할 수 있습니다. 현재 연결의 살아 있는 사본이 있으면 먼저 Google 삭제를 완료한 뒤 로컬 항목을 삭제합니다. 연결이 없거나 다른 계정으로 다시 연결한 과거 사본은 Google에서 직접 관리합니다. 최초 전송 결과가 미확인인 항목은 먼저 같은 전송을 확인해야 합니다.

## API와 충돌 처리

- `GET /api/integrations/google-calendar/exports`: 본인 전송 기록, limit 1~50·offset, 제목/종류/상태만 반환.
- `POST .../exports/change-preview`: kind·item_id·action(update/delete), 변경 전/후 내용과 10분 확인권 반환. 일정 변경과 변경 의도 저장 없음.
- `POST .../exports/change-confirm`: 같은 대상·action·preview_token·엄격한 confirm:true. 확인 내용과 현재 로컬 내용·계정·버전이 일치할 때만 실행.

확인한 변경 내용을 먼저 DB에 저장합니다. 응답 유실 시 같은 변경을 조회해 이미 적용됐으면 쓰지 않고 완료 처리합니다. 다른 변경은 그 결과를 먼저 해결해야 합니다. 삭제된 사본은 최초 전송 버튼으로 복원하거나 중복 생성하지 않습니다.

Google 사본의 관리 필드·소유 표시가 바뀌었거나 참석자/반복/특수 일정으로 바뀌면 거절합니다. 조회와 실행 사이의 변경도 ETag와 If-Match로 보호하며 412 충돌을 덮어쓰지 않습니다. 임의 Google 일정 ID를 입력해 수정하는 API가 아닙니다.

기존 calendar.events.owned 권한을 그대로 사용합니다. [조건부 수정·삭제](https://developers.google.com/workspace/calendar/api/guides/version-resources), [부분 수정](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch), [삭제 응답](https://developers.google.com/workspace/calendar/api/v3/reference/events/delete)을 따릅니다. 외부 요청은 고정 주소·제한 시간·자동 쓰기 재시도 없음으로 실행합니다.

## DB와 복구

Migration `20261102_0009`는 기존 전송 기록에 revision·mutation·deleted_at 3개 필드만 추가합니다. 사용자 일정·이미지·비밀번호를 덮어쓰지 않습니다. 배포 전 구조만 백업하고, 이전 앱으로 복구할 때도 새 필드는 유지하며 DB downgrade하지 않습니다. payload는 마지막으로 반영한 내용이고 mutation은 마지막 확인 작업입니다. 전체 변경 이력을 보존하는 감사 로그는 아닙니다.

코드 복구는 이미 수정·삭제한 실제 Google 일정을 되돌리지 않습니다. Google에서 직접 바꾼 사본의 충돌 해결·삭제 사본 재등록·자동 동기화는 후속 범위입니다.

검사는 가상 Google 응답으로 조건부 요청·응답 유실·권한 격리·기존 기능을 검증합니다. PostgreSQL 검사는 임시 공간에서 구조 호환성을 확인합니다. 실제 개인 Google 캘린더 쓰기를 검증한 것으로 표현하지 않습니다.
