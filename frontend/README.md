# PlanCatch 프론트엔드

Next.js App Router·React·TypeScript 기반 화면입니다. 실제 지원 범위는 이 문서와 [저장소 개요](../README.md)를 기준으로 확인합니다.

## 실행

Node.js20.9 이상과 npm, 테스트용 Google Chrome이 필요합니다. `frontend`에서 `npm ci`로 설치합니다.
기존 환경 파일이 없을 때만 `.env.example`을 `.env.local`로 복사합니다.
별도 로컬 API를 사용하면 `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000`처럼 `/api` 없는 기본 주소를 설정합니다.
같은 origin의 운영 환경은 값을 비워 `/api`로 연결합니다. 브라우저 공개 변수에 비밀정보를 넣지 않습니다.
`npm run dev` 실행 후 http://localhost:3000 에 접속합니다. 환경변수를 바꾸면 서버를 다시 시작하고 운영 빌드는 다시 만듭니다.

## 화면

| 경로 | 기능 |
|---|---|
| /signup, /login | 회원가입·로그인·인증 초기화 |
| /dashboard | 사용자 요약·등록한 일정·마감일 |
| /sources/new | 일정 입력, URL/이미지/원본 텍스트 중 하나 저장, 수동 할 일/마감일 |
| /sources/new?mode=natural | 문장 해석 미리보기·종류/제목/시간 확인 후 할 일/마감일 등록 |
| /sources, /sources/[id] | 제목 검색·선택 삭제·원본 요약/팝업·수정·검토 이력 |
| /analyses/[id] | HTML 또는 AI 후보 검토·제목/일시 수정·선택·저장·승인/거부 |
| /deadlines, /deadlines/[id] | 공식/안전 마감·검색·선택 삭제·연결 작업·Google 자동 반영 상태 |
| /tasks, /tasks/new, /tasks/[id] | 작업 CRUD·목록에서 완료·가능 기간·수동 배치·Google 자동 반영 상태 |
| /calendar | 월/주 캘린더·색상 바·등록 결과·수동 배치·선택형 Google 조회 |
| /settings/google-calendar | Google 계정 연결·상태 확인·해제·보낸 일정 관리 |

사이드바 계정 행의 설정 아이콘으로 비밀번호를 변경합니다. 이름/이메일 변경이나 비밀번호 찾기는 아직 없습니다.
다크/라이트 모드는 브라우저에 저장하고 페이지 이동·새로고침 후 유지합니다.

## 등록·검토 규칙

- 제목 입력란은 ‘일정 제목 (선택)’입니다. 입력한 제목을 새 후보에 전달하고 비워 두면 추출 제목을 사용합니다.
- URL은 공개 HTML을 직접 읽으며 Gemini 전송 동의를 요구하지 않습니다. 사이트에 포함된 이미지를 자동 OCR하지 않습니다.
- PNG/JPG/WebP/BMP/GIF/TIFF/AVIF 한 장(최대5MiB)은 저장 시 PNG로 변환합니다. Ctrl+V로도 첨부할 수 있습니다.
- PDF는 5MiB 이하 한 개를 첨부할 수 있습니다. PDF·이미지·텍스트는 외부 AI 전송에 동의한 뒤 분석합니다. 움직이는 이미지, 다중 프레임 이미지, HEIC·SVG는 지원하지 않습니다.
- 저장 후 바로 검토 준비로 이동합니다. 자료 저장만으로 마감일이 생성되지 않으며 검토·승인 후에만 등록됩니다.
- 날짜만 있으면 한국 시간23:59를 제안합니다. 명시된 시간과 초/밀리초·시간대를 유지하며 사용자가 수정할 수 있습니다.
- 검토 수정 후 저장해야 승인할 수 있습니다. 기존 승인/수정 결과를 새 정책으로 일괄 덮어쓰지 않습니다.
- 수동 등록은 ‘할 일/마감일’을 구분합니다. 할 일은 시작/종료, 마감일은 종료만 입력합니다.
- 마감일·시간이 있는 고정 할 일은 자체 캘린더에 표시됩니다. 유동 가능 기간을 자동 배치하지 않습니다.
- 마감일이 연결된 원본의 직접 삭제는 차단합니다. 마지막 연결 마감일 삭제 시 해당 원본/분석/이미지를 함께 정리합니다.
- Google 연결 후 등록·수정·삭제한 일정은 자동 반영됩니다. 상세 화면과 보낸 일정 관리에서 진행·실패·재시도 상태를 확인합니다. 로컬 삭제는 관리 중인 Google 사본도 삭제합니다. 상세의 완료 처리 버튼은 제거했습니다.

모든 입력/표시는 Asia/Seoul 기준입니다. 인증 토큰은 sessionStorage에 보관하고401/로그아웃 시 제거합니다.
비밀번호 변경 시 현재 브라우저의 인증을 갱신합니다. 비밀번호 연결 정보가 있는 이전 세션은 무효화되지만,
그 기능 도입 전에 발급된 세션은 원래 만료까지 유지됩니다.

## 구조와 문서

app은 경로/레이아웃/전역 스타일, features는 auth·sources·analyses·deadlines·tasks·calendar·google-calendar·settings,
components는 공통 UI, lib은 통신·세션·날짜 처리, types는 API 계약입니다.
[일정 등록](docs/schedule-registration.md), [검토 흐름](docs/ai-review-flow.md), [캘린더](docs/calendar.md),
[Google 전송 계약](../backend/docs/google-calendar-export.md)을 참고하세요.

## 검증

`npm run lint`, `npm run typecheck`, `npm run build`, `npm test` 순으로 검사합니다.
일반 브라우저 검사는 테스트용 주소로 빌드한 뒤3100번 임시 서버에서 PC/모바일을 검사하며 실제 사용자 API 쓰기는 하지 않습니다.
실제 환경으로 실행하려면 테스트 후 실제 API 설정으로 다시 빌드합니다.
`npm run test:live`는 별도 전용 계정·실제 DB 및 외부 AI 호출을 사용할 수 있으므로 일반 검사에 자동 포함하지 않습니다.
