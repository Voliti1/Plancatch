"""Offline configuration contracts; nginx -t also runs before live replacement."""
from pathlib import Path
ROOT=Path(__file__).parent

def test_auth_rate_limit_zone_and_exact_paths():
    zone=(ROOT/"nginx-auth-rate-limit.conf").read_text()
    proxy=(ROOT/"nginx-plancatch.conf").read_text()
    assert "limit_req_zone $binary_remote_addr" in zone and "rate=10r/m" in zone
    assert "zone=plancatch_auth" in proxy and "limit_req_status 429" in proxy
    assert "(login|signup|password|password-recovery|delete)$" in proxy
    callback=proxy.split("location = /api/integrations/google-calendar/callback",1)[1].split("}",1)[0]
    assert "access_log off;" in callback and "error_log /dev/null crit;" in callback
    assert "limit_req " not in callback

def test_https_headers_and_proxy_trust():
    for name in ("nginx-plancatch-domain-https.conf","configure-free-https.py"):
        text=(ROOT/name).read_text()
        for header in ("Strict-Transport-Security","X-Content-Type-Options","X-Frame-Options","Referrer-Policy"):
            assert "add_header "+header in text
    unit=(ROOT/"plancatch-backend.service").read_text()
    assert "--proxy-headers --forwarded-allow-ips=127.0.0.1" in unit
    assert "--host 127.0.0.1" in unit
    assert "--forwarded-allow-ips=*" not in unit
