"""No-network extraction and SSRF regression tests."""

import socket

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
