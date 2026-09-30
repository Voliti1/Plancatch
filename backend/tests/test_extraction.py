"""No-network extraction and SSRF regression tests."""

import http.client
import io
import socket
import time

import pytest

from app.services import extraction as service


@pytest.mark.parametrize("url", [
    "http://127.0.0.1", "http://169.254.169.254/latest/meta-data",
    "http://10.0.0.1", "http://[::1]", "http://100.64.0.1",
    "file:///etc/passwd", "http://user:password@example.com", "http://example.com:8000",
])
def test_unsafe_targets_are_rejected(url):
    with pytest.raises(service.ExtractionError):
        service.public_target(url)


def test_mixed_dns_is_rejected(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **kw: [
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 80)),
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 80)),
    ])
    with pytest.raises(service.ExtractionError, match="unsafe_url"):
        service.public_target("http://example.com")


def test_html_extracts_main_and_ignores_navigation():
    document = service.parse_page(
        b"<title>Notice</title><nav>menu</nav><main><h1>Deadline</h1>"
        b"<p>October 1</p><script>secret()</script></main><footer>footer</footer>",
        "text/html; charset=utf-8",
    )
    assert document.title == "Notice"
    assert document.text == "Deadline\nOctober 1"


def test_login_page_is_not_extracted():
    with pytest.raises(service.ExtractionError, match="requires_login"):
        service.parse_page(b'<form><input type="password"></form>', "text/html")


@pytest.mark.parametrize("attributes", [
    "hidden", 'hidden="false"', 'aria-hidden="true"', 'style="display:none"',
    'style="DISPLAY : none !important; position:absolute"',
    'style="visibility: hidden"', 'style="visibility:collapse"',
    'style="display: /* popup */ none"',
    'style="display:none !important; display:block"',
    'style="display:block; display:none"',
])
def test_hidden_optional_login_does_not_block_or_leak_into_public_text(attributes):
    body = ('<main><h1>Public notice</h1><p>Submit by October 1.</p></main>'
            f'<div {attributes}><form><p>Login-only popup text</p>'
            '<input type="password"></form></div>').encode()
    document = service.parse_page(body, "text/html")
    assert document.text == "Public notice\nSubmit by October 1."


@pytest.mark.parametrize("body", [
    b'<main>Public notice</main><template><input type="password">Hidden text</template>',
    b'<main>Public notice</main><input type="password" hidden>',
    b'<main>Public notice</main><div style><input type aria-hidden></div>',
])
def test_unrendered_or_valueless_attributes_are_safe(body):
    assert service.parse_page(body, "text/html").text == "Public notice"


@pytest.mark.parametrize("body", [
    b'<main>Login</main><form><input type="password"></form>',
    b'<header><form><input type="password"></form></header><main>Login</main>',
    b'<div style="display:none; display:block"><input type="password"></div>',
    b'<div style="display:block !important;display:none"><input type="password"></div>',
])
def test_visible_password_gate_still_blocks_public_extraction(body):
    with pytest.raises(service.ExtractionError, match="requires_login"):
        service.parse_page(body, "text/html")


PUBLIC_RELAY = "https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=12345&view_type=list"
PUBLIC_JOB = "https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=12345"


def relay_markup(canonical=PUBLIC_JOB, visible_login=False):
    login_style = "" if visible_login else 'style="display:none"'
    return (f'<html><head><title>Public job shell</title><link rel="canonical" href="{canonical}">'
            f'</head><body><p>Public shell</p><div {login_style}><form>'
            '<input type="password"></form></div></body></html>').encode()


def test_public_relay_follows_same_job_canonical_under_existing_policy(monkeypatch):
    body = '<title>Public job</title><main><dt>마감일</dt><dd>2026.10.01 23:59</dd></main>'.encode()
    fetched, checked = [], []
    monkeypatch.setattr(service, "public_target", lambda url: ("www.saramin.co.kr", 443, "8.8.8.8"))
    monkeypatch.setattr(service, "check_robots", lambda url, deadline: checked.append(url))
    def fetch(url, deadline):
        fetched.append(url)
        return 200, {"content-type": "text/html; charset=utf-8"}, relay_markup() if url == PUBLIC_RELAY else body
    monkeypatch.setattr(service, "fetch_once", fetch)
    document = service.extract("url", PUBLIC_RELAY, None)
    assert document.title == "Public job"
    assert document.text == "마감일\n2026.10.01 23:59"
    assert fetched == checked == [PUBLIC_RELAY, PUBLIC_JOB]


@pytest.mark.parametrize("canonical", [
    "https://other.example/zf_user/jobs/view?rec_idx=12345",
    "https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=99999",
    "https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=12345&rec_idx=12345",
    "https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=12345&extra=1",
    "https://www.saramin.co.kr/zf_user/auth?rec_idx=12345",
    "http://www.saramin.co.kr/zf_user/jobs/view?rec_idx=12345",
    "https://user:secret@www.saramin.co.kr/zf_user/jobs/view?rec_idx=12345",
    "https://www.saramin.co.kr:8443/zf_user/jobs/view?rec_idx=12345",
    "https://www.saramin.co.kr:invalid/zf_user/jobs/view?rec_idx=12345",
    "http://127.0.0.1/admin",
])
def test_canonical_cannot_change_job_origin_identity_or_credentials(canonical):
    assert service.public_job_canonical(PUBLIC_RELAY, relay_markup(canonical), "text/html") is None


@pytest.mark.parametrize("url", [
    "https://other.example/zf_user/jobs/relay/view?rec_idx=12345",
    "https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=12345&rec_idx=99999",
    "https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=not-a-number",
    "https://www.saramin.co.kr/zf_user/auth?rec_idx=12345",
])
def test_no_generic_canonical_crawler_is_enabled(url):
    assert service.public_job_canonical(url, relay_markup(), "text/html") is None


def test_conflicting_canonical_links_are_not_followed():
    body = relay_markup().replace(b'</head>', b'<link rel="canonical" href="/other"></head>')
    assert service.public_job_canonical(PUBLIC_RELAY, body, "text/html") is None


def test_actual_login_gate_cannot_be_skipped_via_canonical(monkeypatch):
    calls = []
    monkeypatch.setattr(service, "public_target", lambda url: ("www.saramin.co.kr", 443, "8.8.8.8"))
    monkeypatch.setattr(service, "check_robots", lambda *args: None)
    def fetch(url, deadline):
        calls.append(url)
        return 200, {"content-type": "text/html"}, relay_markup(visible_login=True)
    monkeypatch.setattr(service, "fetch_once", fetch)
    with pytest.raises(service.ExtractionError, match="requires_login"):
        service.extract("url", PUBLIC_RELAY, None)
    assert calls == [PUBLIC_RELAY]


def test_canonical_job_robots_denial_is_respected(monkeypatch):
    calls = []
    monkeypatch.setattr(service, "public_target", lambda url: ("www.saramin.co.kr", 443, "8.8.8.8"))
    def robots(url, deadline):
        if url == PUBLIC_JOB:
            raise service.ExtractionError("robots_disallowed")
    def fetch(url, deadline):
        calls.append(url)
        return 200, {"content-type": "text/html"}, relay_markup()
    monkeypatch.setattr(service, "check_robots", robots)
    monkeypatch.setattr(service, "fetch_once", fetch)
    with pytest.raises(service.ExtractionError, match="robots_disallowed"):
        service.extract("url", PUBLIC_RELAY, None)
    assert calls == [PUBLIC_RELAY]


def test_robots_disallow(monkeypatch):
    monkeypatch.setattr(service, "fetch_once", lambda *a: (
        200, {}, b"User-agent: *\nDisallow: /private\n",
    ))
    with pytest.raises(service.ExtractionError, match="robots_disallowed"):
        service.check_robots("https://example.com/private", 0)


def test_redirect_cannot_reach_private_address(monkeypatch):
    monkeypatch.setattr(service, "check_robots", lambda *a: None)
    monkeypatch.setattr(socket, "getaddrinfo", lambda host, *a, **kw: [
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", (
            "127.0.0.1" if host == "127.0.0.1" else "8.8.8.8", 80,
        )),
    ])
    calls = []

    def fetch(url, deadline):
        calls.append(url)
        return 302, {"location": "http://127.0.0.1/admin"}, b""

    monkeypatch.setattr(service, "fetch_once", fetch)
    with pytest.raises(service.ExtractionError, match="unsafe_url"):
        service.extract("url", "https://example.com", None)
    assert len(calls) == 1


@pytest.mark.parametrize("code,reason", [(401, "requires_login"), (403, "access_denied"),
                                        (429, "rate_limited")])
def test_access_failures(monkeypatch, code, reason):
    monkeypatch.setattr(service, "public_target", lambda *a: ("example.com", 443, "8.8.8.8"))
    monkeypatch.setattr(service, "check_robots", lambda *a: None)
    monkeypatch.setattr(service, "fetch_once", lambda *a: (code, {}, b""))
    with pytest.raises(service.ExtractionError, match=reason):
        service.extract("url", "https://example.com", None)


@pytest.mark.parametrize("body,content_type,reason", [
    (b"<script>loadPage()</script>", "text/html", "empty_content_or_rendering_required"),
    (b"pdf", "application/pdf", "unsupported_content_type"),
    (b"x" * (service.MAX_TEXT + 1), "text/plain", "text_too_large"),
], ids=["empty-rendered-page", "unsupported-pdf", "oversized-text"])
def test_invalid_documents(body, content_type, reason):
    with pytest.raises(service.ExtractionError, match=reason):
        service.parse_page(body, content_type)


@pytest.mark.parametrize("framing,body", [
    ("length", b""),
    ("length", b"hello"),
    ("length", b"x" * 100_000),
    ("length", b"x" * service.MAX_BYTES),
    ("chunked", b""),
    ("chunked", b"hello"),
    ("eof", b"hello"),
], ids=["empty-content-length", "short-content-length", "multiple-reads",
        "exact-size-limit", "empty-chunked", "chunked", "connection-eof"])
def test_fetch_once_reads_closed_responses_without_reusing_socket(monkeypatch, framing, body):
    _mock_http_response(monkeypatch, framing, body)
    code, headers, received = service.fetch_once("http://example.com/notice", time.monotonic() + 30)
    assert code == 200
    assert headers["content-type"] == "text/plain"
    assert received == body


def test_fetch_once_still_rejects_oversized_content_length(monkeypatch):
    _mock_http_response(monkeypatch, "length", b"x" * (service.MAX_BYTES + 1))
    with pytest.raises(service.ExtractionError, match="response_too_large"):
        service.fetch_once("http://example.com/notice", time.monotonic() + 30)


def _mock_http_response(monkeypatch, framing, body):
    """Use real HTTPResponse parsing/EOF behavior without any network access."""
    headers = b"HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Type: text/plain\r\n"
    if framing == "length":
        headers += f"Content-Length: {len(body)}\r\n".encode()
        payload = body
    elif framing == "chunked":
        headers += b"Transfer-Encoding: chunked\r\n"
        payload = (f"{len(body):x}\r\n".encode() + body + b"\r\n" if body else b"")
        payload += b"0\r\n\r\n"
    else:
        payload = body

    class FakeSocket:
        def makefile(self, mode):
            raw = io.BytesIO(headers + b"\r\n" + payload)
            raw._sock = self
            return io.BufferedReader(raw)

        def settimeout(self, timeout):
            assert 0 < timeout <= 8

    class FakeConnection:
        def __init__(self, *args, **kwargs):
            self.sock = None

        def request(self, *args, **kwargs):
            pass

        def getresponse(self):
            response = http.client.HTTPResponse(self.sock)
            response.begin()
            self.sock = None  # Connection: close transfers ownership to response.
            return response

        def close(self):
            pass

    monkeypatch.setattr(service, "public_target", lambda url: ("example.com", 80, "8.8.8.8"))
    monkeypatch.setattr(service.socket, "create_connection", lambda *args, **kwargs: FakeSocket())
    monkeypatch.setattr(service.http.client, "HTTPConnection", FakeConnection)
