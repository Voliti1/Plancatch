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
- 기본 HTTP server가 뒤에 포함되는 Amazon Linux 설정을 고려해 별도의 명시적 HTTP fallback을 둔다.
  IP/아직 인증 안 된 호스트의 기존 화면을 유지하며, 새 호스트의 HTTPS 전환만 적용한다.
- 서버 단일 파일 잠금으로 두 호스트의 동시 발급을 막는다.
- 기존 Nginx 설정/앱 스냅샷을 root 전용 `/var/backups/plancatch-https/before-*`에 저장한다.
  개인키·실제 비밀 환경 값·사용자 DB 행은 이 백업에 저장하지 않는다.
- HTTP-01 준비 확인 → staging dry-run 성공 → production 최대 1회 → HTTPS/TLS/308/보호 API 확인.
- 갱신 dry-run 및 공통 Nginx reload hook/공식 certbot-renew.timer를 검증한다.
- 실패 시 이번에 새로 추가한 vhost/hook/timer만 복원한다. 기존 다른 HTTPS 호스트와 키는 유지한다.
- 이번에 새로 추가한 fallback도 실패 시 제거한다. 이미 있던 fallback은 유지한다.
- 발급 제한의 Retry-After 및 반복 간격은 호출자가 지켜야 한다. 스크립트에 자동 재시도 루프는 없다.
- 단위 검사: `python deploy/test_configure_free_https.py`. 이는 합성 검사이며 실제 발급 검증은 별도다.

앱/구글 연결 배포와 인프라 설정 적용 여부는 구분해 기록한다. 이 파일의 커밋을 EC2가 checkout하지
않았어도 검토된 준비 사본으로 실행할 수 있으므로 실제 앱 SHA·준비 사본 해시·백업 경로를 함께 남긴다.
수동 복구는 실행별 before.json/managed-before.json을 확인해 해당 호스트만 제거하고 nginx -t/reload한다.
다른 호스트가 갱신 타이머를 사용하면 중지하지 않는다. 자동 DB downgrade·사용자 데이터 복원은 없다.


## 인증 경로 제한 및 백엔드 서비스

`nginx-auth-rate-limit.conf`는 http 컨텍스트인 `/etc/nginx/conf.d/00-plancatch-auth-rate-limit.conf`에 먼저 설치하고, `nginx-plancatch.conf`를 기존 default.d 파일에 설치한다. 둘을 함께 적용하고 `nginx -t` 통과 후 reload한다. 인증 경로는 IP별 분당 10회와 일시 burst 10회를 허용하며 초과 시 429다. Google callback은 별도의 exact location을 유지하고 access log를 끈다. error log의 crit 필터와 비기록 sink는 쿼리 인증 코드 유출을 차단한다. 원인 추적은 앱의 정제된 결과 로그로 수행한다.

`plancatch-backend.service`는 운영 서비스명에 맞춰 `/etc/systemd/system/plancatch.service`에 설치한다. 기존 `.env`·사용자 데이터·서비스 사용자·경로는 유지하고 로컬 Nginx만 신뢰한다. 설치 전 설정·실행 코드·빌드의 복구 사본을 확보하고 systemd-analyze verify 및 nginx -t를 검사한다. HSTS는 HTTPS 호스트에만 적용하며 인증서 갱신과 공개 /health 응답을 확인한다.
