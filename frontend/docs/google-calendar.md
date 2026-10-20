# Google Calendar 연결 화면

- `/settings/google-calendar`, 로그인 사용자 전용. 주 메뉴에서 진입한다.
- 연결 API의 상태/연결 시작/해제를 사용. /calendar의 선택형 기본 구글 일정 조회를 추가했다.
  일정 등록·수정·삭제 전송과 자동 동기화는 아직 미구현이다.
- 연결 시작은 명시적 클릭만, credentials include로 HttpOnly PKCE/state 브라우저 쿠키 유지.
- 응답 주소는 `https://accounts.google.com/o/oauth2/v2/auth`만 이동 허용한다.
  토큰/인증 코드/인증 URL을 저장하거나 로그로 출력하지 않는다.
- 같은 탭에서 Google로 이동하고, 사용자가 직접 승인한다. 서버 완료 화면의 고정 링크로 돌아온 뒤
  인증된 상태 API를 다시 조회한다. URL 성공 문구만으로 연결됨을 표시하지 않는다.
- 완료/취소/새로고침/다시 포커스 시 상태를 조회한다. 자동 연결·자동 철회·지속 폴링 없음.
- 해제는 확인 후 DELETE. Google 철회를 확인하지 못하면 계정 보안 페이지의 수동 해제를 안내한다.
- 연결 요청의 늦은 응답은 페이지를 벗어난 후 이동/상태 갱신하지 않도록 보호한다.
- 운영 연결은 HTTPS의 정확한 서버 callback/Google 콘솔 URI 등록/서버 키·migration 적용이 필요하다.
  로컬은 localhost와 127.0.0.1 혼용 금지. 브라우저별 origin이 달라지면 플랜캐치 재로그인 필요.
