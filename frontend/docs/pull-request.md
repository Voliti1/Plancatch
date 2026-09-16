# PR 제목

feat(frontend): add authenticated source and deadline management MVP

# 변경 내용

프론트엔드가 없던 저장소에 Next.js App Router와 TypeScript 기반 `frontend`를 추가합니다. 회원가입·로그인 후 URL/텍스트 자료를 저장하고 마감일을 생성·조회·수정·삭제할 수 있습니다.

- 실제 FastAPI 스키마 기반 API 연결, 환경변수로 기본 주소 관리
- sessionStorage JWT, 현재 사용자 조회, 보호 화면, 로그아웃 및 401 처리
- `/login`, `/signup`, `/dashboard`, `/sources`, `/sources/new`, `/deadlines`, `/deadlines/[id]`
- 한국 시간 표시 및 입력 → UTC 변환, 목록 페이지 이동
- 반응형 UI, 로딩·빈 상태·오류 및 재시도, 삭제 확인
- API·타입·화면 분리, 실행 문서 및 백엔드 연동 인계

# 검증

- lint, TypeScript 검사, 프로덕션 build
- Chrome PC / 모바일 브라우저 테스트 8개 통과
- 테스트 전용 응답으로 회원가입·로그인·토큰 복원/제거·접근 제한·자료 등록·마감 CRUD·오류/재시도·401 검증
- 미국 시간대 브라우저에서 한국 시간 입력이 올바른 UTC로 전송되는지 검증
- PC 대시보드와 모바일 상세 화면 캡처 확인 및 가로 넘침 검사
- 개발 서버 실행 확인

# 연동 시 확인할 사항

실제 배포 API 주소가 설정되지 않아 EC2 서버와의 통합 검증은 아직 하지 못했습니다. API 주소 설정, 서로 다른 origin의 CORS와 HTTPS 제공 여부는 백엔드/배포 담당자 확인이 필요합니다. 백엔드 및 인프라 파일은 수정하지 않았습니다.

파일 업로드·AI 분석·Task·자동 배치·Google Calendar는 미구현으로 표시하며 가짜 결과를 노출하지 않습니다. mock 응답은 브라우저 테스트 파일에만 있습니다. sessionStorage 인증은 요청된 MVP 범위입니다.

최종 `main`의 `ad1d84b`를 반영했습니다. 작업 도중 백엔드 Task/Scheduled Event CRUD가 추가되었지만 이번 프론트엔드 연결 범위에는 포함하지 않았습니다.

대상: `feature/frontend-base` → `main`
