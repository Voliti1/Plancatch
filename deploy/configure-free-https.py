"""Add HTTPS to either approved PlanCatch hostname, without deploying the app.

Run with sudo and --domain/--expected-commit after reviewing live server state.
Existing managed hostname, certificate keys, app settings and DB are preserved.
"""

import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import shutil
import socket
import ssl
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid


DOMAINS = {"plancatch.duckdns.org", "plancatch.kro.kr"}
IP = "16.184.24.84"
REPO = Path("/home/ec2-user/Plancatch")
CONF = Path("/etc/nginx/conf.d")
WEBROOT = Path("/var/lib/letsencrypt")
HOOK = Path("/etc/letsencrypt/renewal-hooks/deploy/plancatch-nginx-reload")
HOOK_CONTENT = b"#!/bin/sh\nset -eu\n/usr/sbin/nginx -t\n/usr/bin/systemctl reload nginx\n"
FALLBACK = CONF / "00-plancatch-http-fallback.conf"
FALLBACK_CONTENT = b'''# Preserve the original HTTP application for IP/unmatched hosts.
server {
    listen 80 default_server;
    server_name "";
    include /etc/nginx/default.d/plancatch.conf;
}
'''


def target_path(domain):
    if domain not in DOMAINS:
        raise ValueError("Unapproved hostname")
    return CONF / ("plancatch-" + domain.replace(".", "-") + ".conf")


def configuration(domain, tls=False):
    target_path(domain)  # Validate before interpolating paths/directives.
    shared = "    include /etc/nginx/default.d/plancatch.conf;\n"
    challenge = f"""    location ^~ /.well-known/acme-challenge/ {{
        root {WEBROOT};
        default_type text/plain;
        try_files $uri =404;
    }}
"""
    http = f"server {{\n    listen 80;\n    server_name {domain};\n{challenge}"
    if not tls:
        return (http + shared + "}\n").encode()
    return (http + f"""    location / {{
        return 308 https://{domain}$request_uri;
    }}
}}

server {{
    listen 443 ssl;
    server_name {domain};
    ssl_certificate /etc/letsencrypt/live/{domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/{domain}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:PlanCatchTLS:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;
{shared}}}
""").encode()


def run(*args, capture=False):
    result = subprocess.run(args, text=True, capture_output=capture, check=True, timeout=240)
    return result.stdout.strip() if capture else None


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None


def atomic_write(path, data, mode=0o644):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temporary:
        temporary.write(data)
        temporary.flush()
        os.fsync(temporary.fileno())
        name = Path(temporary.name)
    try:
        name.chmod(mode)
        name.replace(path)
    finally:
        name.unlink(missing_ok=True)


def snapshot():
    protected = [
        REPO / "backend/.env", REPO / ".env", REPO / "frontend/.env.local",
        Path("/etc/nginx/nginx.conf"), Path("/etc/nginx/default.d/plancatch.conf"),
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


def reload_nginx():
    run("/usr/sbin/nginx", "-t")
    run("systemctl", "reload", "nginx")


def timer_state():
    return tuple(subprocess.run(["systemctl", operation, "--quiet", "certbot-renew.timer"]).returncode == 0
                 for operation in ("is-enabled", "is-active"))


def readiness(domain, probe):
    for attempt in range(10):
        try:
            with urllib.request.urlopen(f"http://{domain}/.well-known/acme-challenge/{probe.name}", timeout=5) as response:
                if response.read(64) == b"plancatch-http01-ready\n":
                    return
        except (urllib.error.URLError, TimeoutError):
            pass
        if attempt < 9:
            time.sleep(0.5)
    raise RuntimeError("HTTP-01 readiness failed; no production request made")


def verify_https(domain):
    for path, expected, marker in (("/login", 200, b"PlanCatch"), ("/health", 200, b'"ok"'), ("/api/deadlines", 401, None)):
        try:
            with urllib.request.urlopen(f"https://{domain}{path}", timeout=20) as response:
                status, data = response.status, response.read(2_000_000)
        except urllib.error.HTTPError as error:
            status, data = error.code, error.read(64_000)
        assert status == expected, f"HTTPS {path}: {status}"
        assert marker is None or marker in data, f"Unexpected {path} response"
    connection = http.client.HTTPConnection(domain, timeout=15)
    try:
        connection.request("GET", "/login?https_probe=1")
        response = connection.getresponse()
        assert response.status == 308
        assert response.getheader("Location") == f"https://{domain}/login?https_probe=1"
    finally:
        connection.close()
    with socket.create_connection((domain, 443), timeout=15) as raw:
        with ssl.create_default_context().wrap_socket(raw, server_hostname=domain) as secured:
            certificate = secured.getpeercert()
            assert ssl.cert_time_to_seconds(certificate["notAfter"]) > time.time() + 86400
            return certificate["notAfter"]


def verify_original_http():
    connection = http.client.HTTPConnection(IP, timeout=15)
    try:
        connection.request("GET", "/login")
        response = connection.getresponse()
        assert response.status == 200, "Original IP HTTP route changed"
        assert b"PlanCatch" in response.read(2_000_000)
    finally:
        connection.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--domain", required=True, choices=sorted(DOMAINS))
    parser.add_argument("--expected-commit", required=True)
    args = parser.parse_args()
    assert os.geteuid() == 0, "sudo required"
    assert re.fullmatch(r"[0-9a-f]{40}", args.expected_commit)
    # One remote lock is shared across both domains and interactive/scheduled runs.
    import fcntl
    with Path("/run/lock/plancatch-free-https.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        apply(args.domain, args.expected_commit)


def apply(domain, expected_commit):
    target = target_path(domain)
    assert {item[4][0] for item in socket.getaddrinfo(domain, 80, type=socket.SOCK_STREAM)} == {IP}, "Unexpected DNS"
    assert not target.exists() and not target.is_symlink(), "Target exists; inspect instead of overwriting"
    assert not Path(f"/etc/letsencrypt/live/{domain}").exists(), "Certificate exists; inspect instead of reissuing"
    had_fallback = FALLBACK.exists()
    assert not FALLBACK.is_symlink()
    assert not had_fallback or FALLBACK.read_bytes() == FALLBACK_CONTENT, "Unexpected HTTP fallback"
    others = {path: digest(path) for path in CONF.glob("*.conf") if path != FALLBACK}
    for path in others:
        host = next((host for host in DOMAINS - {domain} if target_path(host) == path), None)
        assert host and not path.is_symlink() and path.read_bytes() == configuration(host, tls=True), "Unrecognized virtual host"
        verify_https(host)
    had_hook = HOOK.exists()
    assert not HOOK.is_symlink()
    assert not had_hook or HOOK.read_bytes() == HOOK_CONTENT, "Unexpected hook"
    initial_timer = timer_state()
    assert initial_timer in ((False, False), (True, True)), "Partial timer state"
    assert not any(initial_timer) or (others and had_hook), "Unexpected timer activation"
    assert run("git", "-C", str(REPO), "status", "--porcelain", "--untracked-files=no", capture=True) == "", "Server tracked changes"
    before = snapshot()
    assert before["commit"] == expected_commit, "Server commit changed"
    assert digest(Path("/etc/nginx/default.d/plancatch.conf")) == digest(REPO / "deploy/nginx-plancatch.conf"), "Proxy drift"
    run("systemctl", "is-active", "--quiet", "plancatch", "plancatch-frontend", "nginx")
    run("/usr/sbin/nginx", "-t")
    run("certbot", "--version")
    backup_root = Path("/var/backups/plancatch-https")
    backup_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    assert not backup_root.is_symlink()
    backup = Path(tempfile.mkdtemp(prefix="before-", dir=backup_root))
    shutil.copy2("/etc/nginx/nginx.conf", backup / "nginx.conf")
    shutil.copy2("/etc/nginx/default.d/plancatch.conf", backup / "plancatch.conf")
    (backup / "before.json").write_text(json.dumps(before, indent=2) + "\n")
    (backup / "managed-before.json").write_text(json.dumps({"vhosts": {str(p): h for p, h in others.items()}, "timer": initial_timer, "had_hook": had_hook, "had_fallback": had_fallback}, indent=2) + "\n")
    print(f"BACKUP={backup}", flush=True)
    challenge_dir = WEBROOT / ".well-known/acme-challenge"
    challenge_dir.mkdir(parents=True, mode=0o755, exist_ok=True)
    probe = challenge_dir / f"plancatch-probe-{uuid.uuid4().hex}"
    enabled_here = False
    try:
        if not had_fallback:
            atomic_write(FALLBACK, FALLBACK_CONTENT)
        atomic_write(target, configuration(domain))
        reload_nginx()
        verify_original_http()
        probe.write_text("plancatch-http01-ready\n")
        probe.chmod(0o644)
        readiness(domain, probe)
        issue = ["certbot", "certonly", "--webroot", "--webroot-path", str(WEBROOT),
                 "--domain", domain, "--cert-name", domain, "--non-interactive", "--agree-tos",
                 "--register-unsafely-without-email", "--key-type", "ecdsa"]
        run(*issue, "--dry-run")
        print(f"PRODUCTION_ATTEMPT domain={domain} utc={time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}", flush=True)
        run(*issue)  # Exactly one; no issuance loop.
        atomic_write(target, configuration(domain, tls=True))
        reload_nginx()
        time.sleep(1)
        expires = verify_https(domain)
        if not had_hook:
            HOOK.parent.mkdir(parents=True, mode=0o755, exist_ok=True)
            atomic_write(HOOK, HOOK_CONTENT, 0o755)
        run("certbot", "renew", "--cert-name", domain, "--dry-run", "--run-deploy-hooks", "--no-random-sleep-on-renew")
        if initial_timer == (False, False):
            enabled_here = True
            run("systemctl", "enable", "--now", "certbot-renew.timer")
        assert timer_state() == (True, True)
        assert snapshot() == before, "App/settings/build/PIDs changed"
        assert {path: digest(path) for path in others} == others, "Other hostname changed"
        run("systemctl", "is-active", "--quiet", "plancatch", "plancatch-frontend", "nginx")
        verify_https(domain)
        verify_original_http()
        result = {"domain": domain, "expires": expires, "application_unchanged": True, "renewal_dry_run": True, "timer_enabled": True}
        (backup / "success.json").write_text(json.dumps(result, indent=2) + "\n")
        print("HTTPS_READY " + json.dumps(result), flush=True)
    except BaseException:
        print("Restoring only this attempt's new vhost/hook/timer; retaining certificate keys", flush=True)
        if enabled_here:
            run("systemctl", "disable", "--now", "certbot-renew.timer")
        if not had_hook:
            HOOK.unlink(missing_ok=True)
        target.unlink(missing_ok=True)
        if not had_fallback:
            FALLBACK.unlink(missing_ok=True)
        reload_nginx()
        assert snapshot() == before, "App/settings/build/PIDs drift during rollback"
        assert {path: digest(path) for path in others} == others
        assert timer_state() == initial_timer
        (backup / "rollback.json").write_text('{"prior_nginx_restored": true, "app_unchanged": true, "keys_retained": true}\n')
        raise
    finally:
        probe.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
