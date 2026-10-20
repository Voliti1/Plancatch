# 승인된 무료 호스트의 HTTPS 설정

`configure-free-https.py`는 plancatch.duckdns.org 또는 plancatch.kro.kr만 처리한다.
앱 코드·실행 빌드·비밀 환경·DB·보안그룹·Google 설정은 배포하지 않는다.
서버의 현재 SHA를 확인하고 전용 준비 폴더에서 sudo로 실행한다.

```
sudo /home/ec2-user/Plancatch/.venv312/bin/python configure-free-https.py \
  --domain plancatch.duckdns.org --expected-commit <확인한-40자리-SHA>
```

- DNS가 승인된 EC2 IP와 일치하고 서버 tracked clean, 기존 proxy가 저장소와 동일해야 한다.
- 이미 인증서/대상 vhost가 있으면 재발급·덮어쓰기하지 않고 중단한다.
- 다른 호스트는 이 도구가 생성하는 정확한 설정일 때만 보존한 채 추가한다.
- 서버 단일 파일 잠금으로 두 호스트의 동시 발급을 막는다.
- 기존 Nginx 설정/앱 스냅샷을 root 전용 `/var/backups/plancatch-https/before-*`에 저장한다.
  개인키·실제 비밀 환경 값·사용자 DB 행은 이 백업에 저장하지 않는다.
- HTTP-01 준비 확인 → staging dry-run 성공 → production 최대 1회 → HTTPS/TLS/308/보호 API 확인.
- 갱신 dry-run 및 공통 Nginx reload hook/공식 certbot-renew.timer를 검증한다.
- 실패 시 이번에 새로 추가한 vhost/hook/timer만 복원한다. 기존 다른 HTTPS 호스트와 키는 유지한다.
- 발급 제한의 Retry-After 및 반복 간격은 호출자가 지켜야 한다. 스크립트에 자동 재시도 루프는 없다.
- 단위 검사: `python deploy/test_configure_free_https.py`. 이는 합성 검사이며 실제 발급 검증은 별도다.

앱/구글 연결 배포와 인프라 설정 적용 여부는 구분해 기록한다. 이 파일의 커밋을 EC2가 checkout하지
않았어도 검토된 준비 사본으로 실행할 수 있으므로 실제 앱 SHA·준비 사본 해시·백업 경로를 함께 남긴다.
수동 복구는 실행별 before.json/managed-before.json을 확인해 해당 호스트만 제거하고 nginx -t/reload한다.
다른 호스트가 갱신 타이머를 사용하면 중지하지 않는다. 자동 DB downgrade·사용자 데이터 복원은 없다.
