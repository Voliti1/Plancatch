# Google Calendar 계정 연결 API

이 단계는 계정 연결·연결 상태·연결 해제만 구현한다. Calendar 이벤트 조회·등록·수정·삭제,
마감일 동기화와 자동 배치는 포함하지 않는다. 연결 화면은
`/settings/google-calendar`이며 기존 내부 캘린더와 별개다.
이전에 성공한 일회용 실제 인증 테스트는 토큰을 보관하지 않았으므로 정식 연결을 대신하지 않는다.

## 설정과 적용 순서

1. 새 의존성(`cryptography`)을 설치하고 기존 설정·실행 코드의 복구 경로를 확보한다.
2. DB revision `20260930_0006`에서 `20261020_0007`로 추가 마이그레이션한다.
   새 테이블 두 개만 생성하며 기존 사용자·마감일·작업 데이터는 변경하지 않는다.
   적용 전 운영 DB 구조와 호환성을 확인한다. 코드 복구 때도 새 테이블은 유지하고
   자동 downgrade나 사용자 데이터 덮어쓰기를 하지 않는다.
3. 서버 전용 `.env`에 다음을 설정한다. 실제 값은 Git, 로그, 브라우저에 노출하지 않는다.

   | 항목 | 용도 |
   |---|---|
   | `GOOGLE_CLIENT_ID` | Google 웹 OAuth 클라이언트 ID |
   | `GOOGLE_CLIENT_SECRET` | 해당 클라이언트 보안 비밀번호 |
   | `GOOGLE_CALENDAR_REDIRECT_URI` | Google 콘솔에 등록한 정확한 콜백 주소 |
   | `GOOGLE_CALENDAR_TOKEN_KEY` | Fernet에서 생성한 별도 암호화 키(JWT 키와 분리) |

   암호화 키는 서버에 안전하게 생성·보관하고 별도로 보호된 복구 수단을 마련한다.
   키 또는 클라이언트 ID가 바뀌면 기존 토큰 복호화가 거절되므로 재연결 또는 별도 키 이전이 필요하다.
4. 운영 환경은 유효한 HTTPS 도메인이 필요하다. 콜백 경로는 반드시
   `/api/integrations/google-calendar/callback`이다. 로컬 개발/테스트에 한해
   `http://localhost:8000/api/integrations/google-calendar/callback`을 사용할 수 있다.
   EC2에서 localhost 콜백으로 운영 연결을 시작하지 않는다.
5. Google Calendar API 활성화, 동의 화면과 최소 범위
   `https://www.googleapis.com/auth/calendar.events.owned`, 테스트 사용자 설정을 확인한다.
   사용자가 직접 권한을 승인해야 한다. 개발자가 사용자를 대신해 동의하지 않는다.
6. 프록시에서 원래 HTTPS 스킴과 호스트를 전달한다. `deploy/nginx-plancatch.conf`의
   콜백 전용 로그 제외 설정도 적용한다. 앱 로그 필터만으로 프록시 로그를 보호할 수 없다.
   HTTPS 도입용 별도 배포 스크립트는 기존 설정 비교 조건을 다시 검토한 뒤 사용한다.

새 코드를 배포하지 않거나 위 설정/마이그레이션을 적용하지 않은 상태는 정식 운영 연결 완료가 아니다.

## API 계약

공통 접두사: `/api/integrations/google-calendar`.
`status`, `connect`, `connection`은 기존 PlanCatch Bearer 로그인 토큰이 필요하다.

| 메서드·경로 | 응답·동작 |
|---|---|
| `GET /status` | `configured`, `connected`, `reconnect_required`, `pending`, `connected_at`, `refresh_expires_at` |
| `POST /connect` | `authorization_url`, `expires_in`(600초), 콜백 경로 전용 HttpOnly 쿠키 설정 |
| `GET /callback` | Google에서 복귀하는 공개 콜백. state·쿠키·PKCE·만료·일회성 검증 후 고정 완료 화면으로 303 이동 |
| `GET /complete` | 제한된 한국어 결과 안내. 이 페이지의 문구 자체를 연결 성공 증명으로 사용하지 않는다 |
| `DELETE /connection` | `disconnected`, `google_revoked`, `manual_revoke_required` |

연결 설정이 없으면 상태는 `configured=false`, 연결 시작은 503이다.
콜백 주소와 연결 시작 API의 스킴·호스트·포트가 다르면 409이다.
잘못되거나 재사용된 콜백은 400, provider 실패는 비밀 정보를 제외한 안내로 종료한다.
응답에는 토큰·암호문·인증 코드·클라이언트 보안 비밀번호를 넣지 않는다.

`connected`는 저장된 토큰의 복호화·범위·알려진 만료 시각을 확인한 로컬 상태다.
매번 Google에 접속해 권한 유효성을 증명하는 값이 아니다. Google에서 별도로 권한을
취소한 경우 등은 후속 실제 API 접근/토큰 갱신 단계에서 처리해야 한다.
현재 단계에는 access token 갱신 및 이벤트 동기화 기능이 없다.

## 프론트엔드 연결 순서

1. 로그인 후 `GET /status`를 호출한다.
2. 사용자가 연결 버튼을 누르면 `POST /connect`를 호출한다.
   로컬 프론트엔드와 API가 다른 포트라면 `credentials: "include"`를 사용하고
   CORS에 정확한 프론트엔드 origin을 허용한다. localhost와 127.0.0.1을 섞지 않는다.
3. 반환받은 Google `authorization_url`로 이동한다. HTTP 응답 쿠키가 브라우저에
   저장된 동일 브라우저에서 진행한다. URL·state를 분석 도구나 로그에 보내지 않는다.
4. 사용자가 Google에서 직접 계정과 권한을 승인한다. offline refresh token을 받아
   유지하는 정식 연결이므로 앞선 일회용 인증 테스트 후에도 다시 동의가 필요하다.
5. 콜백 완료 후 PlanCatch로 돌아와 인증된 `GET /status`로 결과를 다시 확인한다.
   완료 화면은 고정 안내 페이지이며 현재 프론트엔드로 자동 복귀시키지 않는다.
6. 해제 버튼은 `DELETE /connection`을 호출한다. `manual_revoke_required=true`면
   Google 계정 보안 설정에서 수동 권한 해제도 안내한다.

## 저장·보안·한계

- `google_calendar_connections`: 사용자당 연결 하나, refresh token은 사용자·클라이언트·용도에
  결합한 암호화 값만 저장한다. access token은 DB에 저장하지 않는다.
- `google_oauth_requests`: 사용자당 최신 요청 하나, state/브라우저 값은 해시,
  PKCE verifier는 암호화 값, 유효기간 10분이다. 만료 행은 효력이 없고 다음 연결/해제 때 정리된다.
  주기적인 물리 삭제 작업은 이번 범위에 포함하지 않는다.
- 콜백은 외부 코드 교환 전에 원자적으로 소비한다. 연결 시작/완료/해제의 사용자 행 잠금과
  요청 재확인으로 해제 뒤 늦게 도착한 응답이 연결을 복구하지 못하게 한다.
- 새 연결 실패 시 기존 연결은 유지한다. 신규 refresh token이 누락되면 예전 계정의 토큰을
  재사용하지 않는다. 연결 해제는 Google 철회 실패나 암호화 키 분실 시에도 로컬에서 가능하다.
- Google 권한 철회는 동일 Google 계정·프로젝트의 다른 승인에도 영향을 줄 수 있다.
  로컬에서 다른 PlanCatch 사용자의 행을 지우지는 않지만 외부 승인 영향까지 격리한다고 보장하지 않는다.
- 네트워크 오류, 사용자 동의 거부, Google의 권한 만료는 정상적인 실패 경로다.
  테스트 모드/Google 정책에 따라 재연결이 필요할 수 있으므로 무기한 연결을 보장하지 않는다.
- 단위/API 테스트의 Google 응답은 합성 값이다. 실사용자의 토큰 저장·철회 검증이나
  운영 DB 마이그레이션 완료로 간주하지 않는다.

공식 참고: [웹 서버 OAuth 흐름](https://developers.google.com/identity/protocols/oauth2/web-server),
[Calendar 권한 범위](https://developers.google.com/workspace/calendar/api/auth),
[Fernet 암호화](https://cryptography.io/en/stable/fernet/).
