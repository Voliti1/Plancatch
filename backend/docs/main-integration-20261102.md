# 2026-11-02 main 통합 범위

기준 main은75f9e3e1995103e75bdcffe83194a613dfa0a6d7, 통합 시작 운영 버전은9ad0d72575bdf663d213ab53385513fbe97e2c69입니다.
main이 운영 버전의 조상임을 확인했습니다. 77개 커밋/244개 파일의 누적 변경은 이력을 보존하는 통합 PR로 반영합니다.
각 기능을 다시 cherry-pick하거나 같은 기능을 반복 배포하지 않습니다. 실제 병합/배포 SHA와 검증은 PR 본문·작업 기록에 남깁니다.

## 이번 추가 정리

- 보호 API 요청마다 JWT 서명을 두 번 검증하던 코드를 한 번 검증하고 재사용하도록 정리합니다.
- 서명/만료·소유권·활성 사용자·비밀번호 연결 검증과 이전 토큰 호환 정책은 유지합니다.
- 불필요한 설치 환경/실행 빌드/개인 이미지/환경 비밀을 포함하지 않으며 키 파일을 Git에서 제외합니다.
- 등록·이미지·Google 지원 여부가 뒤처진 개요/핵심 인계 문서를 실제 구현에 맞춥니다.
- DB 모델·migration·의존성·사이트 추출 정책·사용자 데이터는 이번 정리에서 바꾸지 않습니다.

## 별도 PR

PR #41의50934e0는 현재 운영 이력에 포함되지 않은 별도 수동 입력 미리보기 변경입니다.
이번 안정 운영 버전 통합에 자동으로 추가하거나 해당 PR을 종료하지 않습니다. 별도 검토 대상으로 유지합니다.
아래 PR들은 커밋 조상 관계로 포함 여부를 확인한 목록이며, 개별 PR 상태와 통합을 통한 main 반영은 구분합니다.
병합 후 이미 포함된 PR을 정리하더라도 원래 기능 브랜치/태그는 보존하고 PR번호별 복구 이력을 유지합니다.

## 병합 전 검증

- 백엔드711개 통과, PostgreSQL 전용7개는 일반 합성 검사에서 제외했습니다. Ruff도 통과했습니다.
- 프론트엔드 lint·타입 검사·운영 빌드 통과. PC·모바일426개 중 최초425개 통과,
  1개는 검사 브라우저의 `net::ERR_NO_BUFFER_SPACE`로 스크립트 로드에 실패했습니다.
  해당 파일을5회 반복해25개 모두 통과했으며 첫 실패 로그도 보관합니다.
- 실제 운영 프론트엔드에서 바뀌는 것은 문서뿐입니다. 이번 최적화를 위해 동일한 화면을 다시 빌드·교체하지 않습니다.
- 현재 추적 파일 및 새로 포함되는 Git blob615개에서 알려진 Google/AWS 키·개인키 형식이 발견되지 않았습니다.
  이 검사가 모든 형식의 비밀정보 부재를 보장하는 것은 아닙니다.
- main 병합 후 EC2에서 정확한 코드·검사 대상 일치, 기존 화면 빌드/PID 유지, DB 구조·환경·이미지 보존,
  HTTPS 상태와 임시 계정의 로그인/비밀번호 변경을 별도로 확인합니다. 완료 여부는 실제 배포 기록으로 구분합니다.

## 기존 PR 이력 포함 목록

| PR | 변경 내용 | 통합 기준 커밋 |
|---|---|---|
| [#14](https://github.com/Voliti1/Plancatch/pull/14) | feat(backend): AI 마감 후보 분석과 검토·승인 API | db6f599 |
| [#15](https://github.com/Voliti1/Plancatch/pull/15) | fix(backend): Gemini 실제 호출 호환성 수정 및 EC2 검증 | d2d8291 |
| [#16](https://github.com/Voliti1/Plancatch/pull/16) | integration: 최신 프론트엔드 작업 관리 기능 EC2 반영 | 472f9a1 |
| [#17](https://github.com/Voliti1/Plancatch/pull/17) | feat(backend): 사용자 여유시간 기반 안전 마감일 | a3ffb86 |
| [#18](https://github.com/Voliti1/Plancatch/pull/18) | feat(frontend): connect source extraction and AI deadline review | 66d17c8 |
| [#20](https://github.com/Voliti1/Plancatch/pull/20) | feat(frontend): add safety deadline settings and display | b173c6e |
| [#21](https://github.com/Voliti1/Plancatch/pull/21) | feat: 대시보드 제목·URL 기반 자동 일정 등록 | c0ddc87 |
| [#22](https://github.com/Voliti1/Plancatch/pull/22) | fix: 사람인 공개 공고의 숨겨진 로그인 팝업 오판 수정 | e79bddc |
| [#23](https://github.com/Voliti1/Plancatch/pull/23) | 공개 HTML의 동일 공고 마감일 구조화 데이터 추출 개선 | 5dae020 |
| [#24](https://github.com/Voliti1/Plancatch/pull/24) | fix: 새 일정 입력과 중단된 등록 재개 분리 | 9a53aed |
| [#25](https://github.com/Voliti1/Plancatch/pull/25) | fix: 재개 등록 편집 허용 및 사이드바 새 일정 버튼 | 360494b |
| [#26](https://github.com/Voliti1/Plancatch/pull/26) | fix: 이전 등록 편집 시 재개 안내가 다시 뜨는 오류 수정 | 8ccd3fd |
| [#27](https://github.com/Voliti1/Plancatch/pull/27) | 원본 자료 회사명·마감일 요약 및 전체 내용 팝업 | a8f5ac3 |
| [#28](https://github.com/Voliti1/Plancatch/pull/28) | 시간대가 없는 완전한 마감 일시는 한국 시간 기본값 적용 | 7854c71 |
| [#29](https://github.com/Voliti1/Plancatch/pull/29) | 안전 마감일 화면을 현재 URL 자동 등록·AI 운영 코드와 통합 | 6845538 |
| [#30](https://github.com/Voliti1/Plancatch/pull/30) | feat: 사람인 접수기간 추출과 분석 화면 남은 시간 표시 | 2769136 |
| [#31](https://github.com/Voliti1/Plancatch/pull/31) | fix: 사람인 URL 마감일을 AI 대신 HTML에서 직접 확정 | 8acd7fa |
| [#32](https://github.com/Voliti1/Plancatch/pull/32) | 검토 화면 간소화: 자료 요약과 짧은 마감일 근거만 표시 | cc27560 |
| [#33](https://github.com/Voliti1/Plancatch/pull/33) | 프론트엔드 통합: 자료 등록 화면·마감일 검토 요약 | 5398d3e |
| [#34](https://github.com/Voliti1/Plancatch/pull/34) | 마감일 검토: 접수기간과 자료 정보를 같은 행에 배치 | 7de5630 |
| [#35](https://github.com/Voliti1/Plancatch/pull/35) | fix(frontend): 새 일정 버튼에서 자료 입력 화면 바로 열기 | e44794d |
| [#36](https://github.com/Voliti1/Plancatch/pull/36) | 등록 진입 통합·늦은 저장 응답의 새 화면 이동 오류 수정 | 6a28ed3 |
| [#37](https://github.com/Voliti1/Plancatch/pull/37) | feat(frontend): 작업 메뉴를 새 일정의 수동 등록으로 통합 | 373d5be |
| [#38](https://github.com/Voliti1/Plancatch/pull/38) | feat: 수동 일정 등록 통합 및 늦은 저장 응답 보호 | 91bfd83 |
| [#39](https://github.com/Voliti1/Plancatch/pull/39) | feat(frontend): 수동 일정 등록을 간단한 캘린더 입력 형태로 개선 | 067ae6c |
| [#40](https://github.com/Voliti1/Plancatch/pull/40) | feat(backend): Google Calendar 사용자별 연결·상태·해제 API | b8d98ca |
| [#42](https://github.com/Voliti1/Plancatch/pull/42) | feat(integration): 수동 일정 간소화·대시보드 일정 목록 통합 | ce43bb4 |
| [#43](https://github.com/Voliti1/Plancatch/pull/43) | 운영 앱 보존형 무료 도메인 HTTPS 설정 도구 | f0d2a4f |
| [#44](https://github.com/Voliti1/Plancatch/pull/44) | feat(frontend): 내부 캘린더와 수동 일정 배치 연결 | e1fb0f5 |
| [#45](https://github.com/Voliti1/Plancatch/pull/45) | 팀원 내부 캘린더·수동 배치 화면 통합 및 EC2 반영 | 6724201 |
| [#46](https://github.com/Voliti1/Plancatch/pull/46) | 구글 캘린더 계정 연결 화면·API 통합 및 HTTPS 운영 적용 | 45754e2 |
| [#47](https://github.com/Voliti1/Plancatch/pull/47) | 구글 인증 완료 화면을 플랜캐치 브랜드 디자인으로 정리 | 29d945f |
| [#48](https://github.com/Voliti1/Plancatch/pull/48) | 구글 기본 캘린더 일정 조회 및 자체 캘린더 표시 | bb43ae1 |
| [#49](https://github.com/Voliti1/Plancatch/pull/49) | 기존 자료·수동 등록 일정의 캘린더 표시와 색상 제목 바 | 634e5ce |
| [#50](https://github.com/Voliti1/Plancatch/pull/50) | 수동 등록의 할 일·마감일 구분 및 카드 너비 통일 | 7f433fe |
| [#51](https://github.com/Voliti1/Plancatch/pull/51) | URL HTML 날짜 선택·검토 및 실패 분석 복구 완성 | 45402fb |
| [#52](https://github.com/Voliti1/Plancatch/pull/52) | Google 캘린더 명시적 일정 등록과 중복 전송 방지 | 21e5f78 |
| [#53](https://github.com/Voliti1/Plancatch/pull/53) | 자료 저장 후 원문 추출과 마감일 검토로 바로 연결 | 719c2eb |
| [#54](https://github.com/Voliti1/Plancatch/pull/54) | 원본 자료·마감일 목록의 선택 삭제 모드와 두 단계 확인 | ac6af23 |
| [#55](https://github.com/Voliti1/Plancatch/pull/55) | 목록 선택 수를 삭제 버튼 왼쪽의 작은 표시로 정리 | 076e553 |
| [#56](https://github.com/Voliti1/Plancatch/pull/56) | 두 목록의 선택 수 글씨를 11pt로 확대 | 3236179 |
| [#57](https://github.com/Voliti1/Plancatch/pull/57) | 마감일이 연결된 원본 자료 삭제 차단 | 4e7864a |
| [#58](https://github.com/Voliti1/Plancatch/pull/58) | 원본 자료·마감일 실시간 제목 검색과 일치 부분 강조 | 3e4770c |
| [#59](https://github.com/Voliti1/Plancatch/pull/59) | 마감일 검토 화면의 사이트 남은 기간 표시 제거 | 23cc964 |
| [#60](https://github.com/Voliti1/Plancatch/pull/60) | feat: 잡코리아 HTML 타이머 마감일 추출 및 검토 연결 | 76fa86e |
| [#61](https://github.com/Voliti1/Plancatch/pull/61) | 이미지 업로드와 동의 후 마감일 추출·검토 연결 | a90e017 |
| [#62](https://github.com/Voliti1/Plancatch/pull/62) | feat: 캐치 HTML 접수기간 추출 및 마감일 검토 연결 | 6d7af99 |
| [#63](https://github.com/Voliti1/Plancatch/pull/63) | feat: 잡플래닛 마감 날짜 추출과 시각 확인 흐름 추가 | db469ef |
| [#64](https://github.com/Voliti1/Plancatch/pull/64) | PNG 형식 표기 호환과 다양한 이미지의 PNG 변환 지원 | 1b6c543 |
| [#65](https://github.com/Voliti1/Plancatch/pull/65) | feat: 자소설닷컴 접수기간 추출 및 한국 시간 검토 연결 | 11abe32 |
| [#66](https://github.com/Voliti1/Plancatch/pull/66) | feat: 링커리어 접수기간 추출 및 마감일 검토 연결 | f4d17d3 |
| [#67](https://github.com/Voliti1/Plancatch/pull/67) | 전체 회귀 점검: AI 정상 응답 실패 수정 및 조회·DB·이미지 처리 최적화 | 861533a |
| [#68](https://github.com/Voliti1/Plancatch/pull/68) | 사이트별 HTML 마감일 추출 통합: 잡코리아·캐치·잡플래닛·자소설·링커리어 | e39c94c |
| [#69](https://github.com/Voliti1/Plancatch/pull/69) | 캐치 24시 마감 오판 수정 및 동일 공고 기업명 추출 | f74c924 |
| [#70](https://github.com/Voliti1/Plancatch/pull/70) | feat: 고용24 공개 공고 마감일 추출 및 24:00 검토 연결 | bb2a212 |
| [#71](https://github.com/Voliti1/Plancatch/pull/71) | 고용24 HTML 마감일·기업명 추출 통합 | 4363c3b |
| [#72](https://github.com/Voliti1/Plancatch/pull/72) | 캐치 마감일 span 내부·옆의 홍보 문구 제외 | 67f5527 |
| [#73](https://github.com/Voliti1/Plancatch/pull/73) | 오전·오후 마감 시간 인식 수정 및 시간 없는 날짜 23:59 자동 입력 | 403c586 |
| [#74](https://github.com/Voliti1/Plancatch/pull/74) | 마지막 연결 마감일 삭제 시 원본 자료·검토 기록·이미지 함께 정리 | 5f45b27 |
| [#75](https://github.com/Voliti1/Plancatch/pull/75) | 새 일정 등록에서 캡처 이미지 Ctrl+V 붙여넣기 지원 | 0c74a8d |
| [#76](https://github.com/Voliti1/Plancatch/pull/76) | 이미지 선택 영역의 미업로드 문구 제거 | 2c29dc9 |
| [#77](https://github.com/Voliti1/Plancatch/pull/77) | fix: 캡처의 한국어·점 표기 마감 시간 보존 | 6df4137 |
| [#78](https://github.com/Voliti1/Plancatch/pull/78) | fix: 일정 입력 명칭과 마감일 후보 제목 전달 | 07bf251 |
| [#79](https://github.com/Voliti1/Plancatch/pull/79) | feat: 계정 설정·비밀번호 변경과 다크 모드 | 9ad0d72 |
