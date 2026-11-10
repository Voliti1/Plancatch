"""One-time, narrowly scoped HTTPS bootstrap for the existing PlanCatch EC2.

Run the reviewed directory on EC2 with sudo python3.12 enable-domain-https.py
--expected-commit <actual deployed SHA>. Does not deploy application code or DBs.
Certificate/account private keys stay in /etc/letsencrypt and out of Git/backups.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid


DOMAIN = "plancatch.kro.kr"
IP = "16.184.24.84"
REPO = Path("/home/ec2-user/Plancatch")
TARGET = Path("/etc/nginx/conf.d/plancatch-domain.conf")
HOOK = Path("/etc/letsencrypt/renewal-hooks/deploy/plancatch-nginx-reload")
WEBROOT = Path("/var/lib/letsencrypt")
ASSETS = Path(__file__).resolve().parent


def run(*args, capture=False):
    result = subprocess.run(args, text=True, capture_output=capture, check=True)
    return result.stdout.strip() if capture else None


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None


def atomic_write(path, data, mode=0o644):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temporary:
        name = Path(temporary.name)
        temporary.write(data)
        temporary.flush()
        os.fsync(temporary.fileno())
    try:
        name.chmod(mode)
        name.replace(path)
    finally:
        name.unlink(missing_ok=True)


def snapshot():
    # Only hashes, never environment contents or credentials.
    protected = [
        REPO / "backend/.env",
        REPO / ".env",
        REPO / "frontend/.env.local",
        Path("/etc/nginx/nginx.conf"),
        Path("/etc/nginx/default.d/plancatch.conf"),
        Path("/etc/systemd/system/plancatch.service"),
        Path("/etc/systemd/system/plancatch-frontend.service"),
    ]
    return {
        "commit": run("git", "-C", str(REPO), "rev-parse", "HEAD", capture=True),
        "backend_tree": run("git", "-C", str(REPO), "rev-parse", "HEAD:backend", capture=True),
        "frontend_tree": run("git", "-C", str(REPO), "rev-parse", "HEAD:frontend", capture=True),
        "build_id": (REPO / "frontend/.next/BUILD_ID").read_text().strip(),
        "pids": run("systemctl", "show", "plancatch", "plancatch-frontend", "-p", "MainPID", capture=True),
        "hashes": {str(path): digest(path) for path in protected},
    }


def request(path, code, body=None):
    try:
        with urllib.request.urlopen(f"https://{DOMAIN}{path}", timeout=20) as response:
            status, data = response.status, response.read()
    except urllib.error.HTTPError as error:
        status, data = error.code, error.read()
    assert status == code, f"Unexpected HTTPS status for {path}: {status}"
    if body:
        assert body in data, f"Unexpected HTTPS body for {path}"


def reload_nginx():
    run("/usr/sbin/nginx", "-t")
    run("systemctl", "reload", "nginx")


def check_http_challenge(probe):
    # Nginx reload is graceful: old workers can briefly answer with the old vhost.
    # Retry only this idempotent readiness GET, never certificate issuance.
    url = f"http://{DOMAIN}/.well-known/acme-challenge/{probe.name}"
    for attempt in range(10):
        try:
            with urllib.request.urlopen(url, timeout=5) as response:
                if response.read() == b"plancatch-http01-ready\n":
                    return
        except (urllib.error.URLError, TimeoutError):
            pass
        if attempt < 9:
            time.sleep(0.5)
    raise RuntimeError("HTTP challenge did not become ready after nginx reload")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expected-commit", required=True)
    args = parser.parse_args()
    assert os.geteuid() == 0, "Run using sudo"
    assert re.fullmatch(r"[0-9a-f]{40}", args.expected_commit), "Full SHA required"
    assert {item[4][0] for item in socket.getaddrinfo(DOMAIN, 80, type=socket.SOCK_STREAM)} == {IP}, "Unexpected DNS target"
    assert not TARGET.exists(), "HTTPS config already exists; inspect rather than overwrite"
    assert not HOOK.exists(), "Renew hook already exists; inspect rather than overwrite"
    assert not Path(f"/etc/letsencrypt/live/{DOMAIN}").exists(), "Certificate already exists; inspect instead of reissuing"
    assert not list(Path("/etc/nginx/conf.d").glob("*.conf")), "Unexpected existing virtual hosts"
    assert run("git", "-C", str(REPO), "status", "--porcelain", "--untracked-files=no", capture=True) == "", "Tracked server changes exist"
    before = snapshot()
    assert before["commit"] == args.expected_commit, "Server commit changed"
    assert digest(Path("/etc/nginx/default.d/plancatch.conf")) == digest(REPO / "deploy/nginx-plancatch.conf"), "Unexpected proxy configuration"
    assert subprocess.run(["systemctl", "is-active", "--quiet", "certbot-renew.timer"]).returncode != 0, "Renewal timer already active; inspect first"
    assert subprocess.run(["systemctl", "is-enabled", "--quiet", "certbot-renew.timer"]).returncode != 0, "Renewal timer already enabled; inspect first"
    run("/usr/sbin/nginx", "-t")
    run("certbot", "--version")

    backup_root = Path("/var/backups/plancatch-https")
    backup_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    assert not backup_root.is_symlink()
    backup = Path(tempfile.mkdtemp(prefix="before-", dir=backup_root))
    shutil.copy2("/etc/nginx/nginx.conf", backup / "nginx.conf")
    shutil.copy2("/etc/nginx/default.d/plancatch.conf", backup / "plancatch.conf")
    (backup / "before.json").write_text(json.dumps(before, indent=2) + "\n")
    print(f"BACKUP={backup}", flush=True)

    challenge_dir = WEBROOT / ".well-known/acme-challenge"
    challenge_dir.mkdir(parents=True, mode=0o755, exist_ok=True)
    probe = challenge_dir / f"plancatch-probe-{uuid.uuid4().hex}"
    timer_enabled = False
    try:
        bootstrap = f"""server {{
    listen 80;
    server_name {DOMAIN};
    location ^~ /.well-known/acme-challenge/ {{
        root {WEBROOT};
        default_type text/plain;
        try_files $uri =404;
    }}
    include /etc/nginx/default.d/plancatch.conf;
}}
"""
        atomic_write(TARGET, bootstrap.encode())
        reload_nginx()
        probe.write_text("plancatch-http01-ready\n")
        probe.chmod(0o644)
        check_http_challenge(probe)

        issue = [
            "certbot", "certonly", "--webroot", "--webroot-path", str(WEBROOT),
            "--domain", DOMAIN, "--cert-name", DOMAIN, "--non-interactive",
            "--agree-tos", "--register-unsafely-without-email", "--key-type", "ecdsa",
        ]
        run(*issue, "--dry-run")
        run(*issue)
        atomic_write(TARGET, (ASSETS / "nginx-plancatch-domain-https.conf").read_bytes())
        reload_nginx()
        time.sleep(1)
        request("/login", 200, b"PlanCatch")
        request("/health", 200)
        request("/api/deadlines", 401)

        HOOK.parent.mkdir(parents=True, mode=0o755, exist_ok=True)
        atomic_write(HOOK, (ASSETS / "certbot-nginx-reload.sh").read_bytes(), 0o755)
        run("certbot", "renew", "--cert-name", DOMAIN, "--dry-run", "--run-deploy-hooks", "--no-random-sleep-on-renew")
        # Mark before enabling so a partially failed enable also gets rolled back.
        timer_enabled = True
        run("systemctl", "enable", "--now", "certbot-renew.timer")
        run("systemctl", "is-active", "--quiet", "certbot-renew.timer")
        run("systemctl", "is-enabled", "--quiet", "certbot-renew.timer")
        request("/login", 200, b"PlanCatch")
        request("/health", 200)
        request("/api/deadlines", 401)
        assert before == snapshot(), "Application state unexpectedly changed"
        (backup / "success.json").write_text(json.dumps({"domain": DOMAIN, "application_unchanged": True, "renewal_dry_run": True, "timer_enabled": True}, indent=2) + "\n")
        print("HTTPS_READY; application/env/build/PIDs unchanged; renewal simulation passed", flush=True)
    except BaseException:
        print("Restoring prior HTTP-only nginx configuration", flush=True)
        if timer_enabled:
            run("systemctl", "disable", "--now", "certbot-renew.timer")
        # These two exact new files did not exist at preflight. Do not remove keys.
        HOOK.unlink(missing_ok=True)
        TARGET.unlink(missing_ok=True)
        reload_nginx()
        (backup / "rollback.json").write_text('{"http_config_restored": true, "certificate_retained_if_issued": true}\n')
        raise
    finally:
        probe.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
