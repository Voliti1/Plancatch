# PlanCatch 프론트엔드

Next.js App Router · TypeScript 기반 MVP입니다. 백엔드 코드 및 배포 설정은 변경하지 않습니다.

## 실행

Node.js 20.9 이상과 npm이 필요합니다. 저장소를 클론한 위치에서 `frontend`로 이동합니다.

```sh
npm ci
```

`.env.example`을 `.env.local`로 복사한 뒤 `NEXT_PUBLIC_API_BASE_URL`에 백엔드 기본 주소를 설정합니다. 값에 `/api`를 붙이지 않습니다. 브라우저에 공개되는 주소이므로 비밀정보를 넣지 않습니다. `.env.local`은 Git에서 제외됩니다.

```sh
npm run dev
```

브라우저에서 `http://localhost:3000`을 엽니다. 환경변수를 변경하면 개발 서버를 다시 시작합니다. 배포용 빌드에서는 빌드 전에 주소를 설정해야 합니다.

## 화면과 API

| 화면              | 동작                                                 |
| ----------------- | ---------------------------------------------------- |
| `/signup`         | JSON 회원가입, 비밀번호 확인, 성공 후 로그인 안내    |
| `/login`          | JSON 로그인, `/api/auth/me`로 사용자 검증            |
| `/dashboard`      | 사용자 이름, 자료·마감 요약, 마감일 목록             |
| `/sources`        | 자료 목록, URL 열기, 원본 텍스트 펼치기, 페이지 이동 |
| `/sources/new`    | URL 또는 텍스트 원본 자료 저장                       |
| `/deadlines`      | 마감 목록, 생성, 페이지 이동                         |
| `/deadlines/[id]` | 상세·수정·삭제 확인, 서버가 반환한 분석 근거 표시    |

모든 업무 화면은 인증 초기화와 사용자 조회가 끝나기 전까지 내용을 표시하지 않습니다. 토큰은 `sessionStorage`에만 보관하며 인증 요청에 Bearer 헤더를 붙입니다. 로그아웃 및 인증 API의 401 응답 시 토큰과 사용자 상태를 제거합니다. 프론트엔드의 접근 제한과 별개로 데이터 접근 권한은 백엔드가 검증해야 합니다. sessionStorage 방식은 MVP 범위이며 추후 HttpOnly 쿠키 기반 인증 전환을 검토할 수 있습니다.

목록 API의 `limit=50`, `offset`을 사용합니다. 대시보드 수치는 첫 50건 기준이며 50건이면 `50+`로 표시합니다. 원본 자료 연결 값과 분석 근거는 수정 과정에서 보존합니다. 마감 생성 시 원본 연결은 이번 화면 범위에 포함하지 않습니다.

날짜 표시는 `Asia/Seoul`입니다. 마감 입력도 브라우저/PC의 시간대와 관계없이 한국 시간으로 해석하여 UTC ISO 8601로 전송합니다.

## 구조

```text
app/                 경로, 레이아웃, 전역 스타일
components/          공통 피드백, 제목, 페이지 이동
features/auth/       인증 API, 사용자 상태, 로그인·회원가입 폼
features/sources/    원본 자료 API와 화면
features/deadlines/  마감일 API와 화면
lib/api/             HTTP·오류 처리, 데이터 조회 훅
lib/auth/            세션 토큰 저장
lib/date/            한국 시간 변환
types/               백엔드 요청·응답 타입
tests/               테스트 전용 API 응답과 브라우저 시나리오
docs/                백엔드 연동 및 PR 인계 자료
```

Task, Schedule, Calendar API가 확정되면 각각 `features/tasks`, `features/schedules`, `features/calendar`에 API와 화면을 추가합니다. 현재 미완성 기능의 실행 버튼이나 가짜 분석 결과는 제공하지 않습니다. 운영 코드에는 mock이 없고, 테스트 응답만 `tests/fixtures.ts`에 분리되어 있습니다.

## 검증

```sh
npm run lint
npm run typecheck
npm run build
npm test
```

브라우저 테스트는 설치된 Google Chrome을 사용하며 테스트용 환경변수로 빌드한 후 3100 포트에 서버를 자동 실행합니다. 테스트 후 실제 서버를 대상으로 `npm start`를 실행하려면 실제 환경변수로 `npm run build`를 다시 실행해야 합니다. 테스트의 API 응답은 브라우저 요청을 가로채서 제공하므로 실제 계정 생성이나 서버 데이터 변경을 하지 않습니다. 일반 개발 서버에는 적용되지 않습니다. 테스트는 PC/모바일 화면에서 회원가입·로그인·새로고침·로그아웃·보호 경로·URL/텍스트 등록·마감 CRUD·한국 시간 변환·오류/재시도·401 만료 처리를 확인합니다. PC 테스트의 브라우저 시간대는 `America/Los_Angeles`로 지정하여 한국 시간 변환이 PC 설정에 영향받지 않는지도 검사합니다.

실제 서버의 CORS, HTTPS, 데이터 저장 여부는 [백엔드 연동 문서](docs/backend-integration.md)의 수동 검증 절차로 별도 확인해야 합니다.
