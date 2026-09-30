"""Bounded, public-only single-page extraction; never uses user cookies."""

import http.client
import ipaddress
import socket
import ssl
import time
from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit
from urllib.robotparser import RobotFileParser

MAX_BYTES = 2_000_000
MAX_TEXT = 100_000
USER_AGENT = "PlanCatchBot/0.1"


class ExtractionError(Exception):
    """A safe, client-visible failure code (no credentials or response bodies)."""


@dataclass
class Document:
    text: str
    title: str | None = None


def public_target(url: str) -> tuple[str, int, str]:
    try:
        parts = urlsplit(url)
        if (parts.scheme not in {"http", "https"} or not parts.hostname
                or parts.username is not None or parts.password is not None
                or any(ord(char) < 32 for char in url)):
            raise ValueError
        port = parts.port or (443 if parts.scheme == "https" else 80)
        if port not in {80, 443}:
            raise ValueError
        host = parts.hostname.encode("idna").decode("ascii")
        addresses = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except (ValueError, UnicodeError, OSError) as exc:
        raise ExtractionError("invalid_or_unreachable_url") from exc
    # Reject mixed DNS answers too. Pin the actual connection to the validated IP.
    ips = [item[4][0] for item in addresses]
    if not ips or any(not ipaddress.ip_address(ip).is_global for ip in ips):
        raise ExtractionError("unsafe_url")
    return host, port, ips[0]


def fetch_once(url: str, deadline: float) -> tuple[int, dict[str, str], bytes]:
    host, port, ip = public_target(url)
    parts = urlsplit(url)
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise ExtractionError("fetch_timeout")
    conn = http.client.HTTPConnection(host, port, timeout=min(8, remaining))
    try:
        conn.sock = socket.create_connection((ip, port), timeout=min(8, remaining))
        if parts.scheme == "https":
            conn.sock = ssl.create_default_context().wrap_socket(conn.sock, server_hostname=host)
        path = parts.path or "/"
        if parts.query:
            path += "?" + parts.query
        conn.request("GET", path, headers={
            "User-Agent": USER_AGENT, "Accept": "text/html,text/plain",
            "Accept-Encoding": "identity", "Connection": "close",
        })
        response = conn.getresponse()
        headers = {key.lower(): value for key, value in response.getheaders()}
        if response.status in {301, 302, 303, 307, 308, 401, 403, 429}:
            return response.status, headers, b""
        if headers.get("content-encoding", "identity").lower() not in {"identity", ""}:
            raise ExtractionError("unsupported_encoding")
        chunks, size = [], 0
        # Content-Length (including zero) closes the response as soon as the
        # final bytes are consumed. Do not dereference its released file/socket.
        while not response.isclosed():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ExtractionError("fetch_timeout")
            # HTTPResponse owns the socket after Connection: close.
            response.fp.raw._sock.settimeout(min(8, remaining))
            chunk = response.read1(min(65536, MAX_BYTES + 1 - size))
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_BYTES:
                raise ExtractionError("response_too_large")
            chunks.append(chunk)
        return response.status, headers, b"".join(chunks)
    except (OSError, http.client.HTTPException) as exc:
        raise ExtractionError("fetch_failed") from exc
    finally:
        conn.close()


def check_robots(url: str, deadline: float) -> None:
    parts = urlsplit(url)
    code, _, body = fetch_once(f"{parts.scheme}://{parts.netloc}/robots.txt", deadline)
    if code in {404, 410}:
        return
    if code != 200:
        raise ExtractionError("robots_unavailable")
    parser = RobotFileParser()
    parser.parse(body.decode("utf-8", errors="replace").splitlines())
    if not parser.can_fetch(USER_AGENT, url):
        raise ExtractionError("robots_disallowed")


class PageParser(HTMLParser):
    """Extract visible text without executing JavaScript or fetching subresources."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack: list[tuple[str, bool]] = []
        self.body: list[str] = []
        self.main: list[str] = []
        self.title: list[str] = []
        self.password_form = False

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "input" and values.get("type", "").lower() == "password":
            self.password_form = True
        hidden = (tag in {"script", "style", "nav", "footer", "header", "noscript"}
                  or "hidden" in values or values.get("aria-hidden") == "true"
                  or any(skip for _, skip in self.stack))
        if tag not in {"area", "base", "br", "col", "embed", "hr", "img", "input",
                       "link", "meta", "param", "source", "track", "wbr"}:
            self.stack.append((tag, hidden))

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break

    def handle_data(self, data):
        text = " ".join(data.split())
        if not text:
            return
        if any(tag == "title" for tag, _ in self.stack):
            self.title.append(text)
        elif not any(skip for _, skip in self.stack):
            self.body.append(text)
            if any(tag in {"main", "article"} for tag, _ in self.stack):
                self.main.append(text)


def parse_page(body: bytes, content_type: str) -> Document:
    media_type = content_type.split(";", 1)[0].strip().lower()
    charset = "utf-8"
    for parameter in content_type.split(";")[1:]:
        if parameter.strip().lower().startswith("charset="):
            charset = parameter.split("=", 1)[1].strip().strip('"')
    try:
        decoded = body.decode(charset, errors="replace")
    except LookupError as exc:
        raise ExtractionError("unsupported_encoding") from exc
    if media_type == "text/plain":
        text, title = decoded.strip(), None
    elif media_type in {"text/html", "application/xhtml+xml"}:
        parser = PageParser()
        parser.feed(decoded)
        # Password inputs are a conservative heuristic; never submit the form.
        if parser.password_form:
            raise ExtractionError("requires_login")
        text = "\n".join(parser.main or parser.body)
        title = " ".join(parser.title)[:255] or None
    else:
        raise ExtractionError("unsupported_content_type")
    if not text.strip():
        raise ExtractionError("empty_content_or_rendering_required")
    if len(text) > MAX_TEXT:
        raise ExtractionError("text_too_large")
    return Document(text, title)


def extract(source_type: str, original_url: str | None, original_text: str | None) -> Document:
    if source_type == "text":
        text = (original_text or "").strip()
        if not text:
            raise ExtractionError("empty_content")
        if len(text) > MAX_TEXT:
            raise ExtractionError("text_too_large")
        return Document(text)
    if source_type != "url" or not original_url:
        raise ExtractionError("unsupported_source_type")
    url = original_url
    deadline = time.monotonic() + 30
    for _ in range(4):
        public_target(url)
        check_robots(url, deadline)
        code, headers, body = fetch_once(url, deadline)
        if code in {301, 302, 303, 307, 308}:
            location = headers.get("location")
            if not location:
                raise ExtractionError("invalid_redirect")
            url = urljoin(url, location)
            continue
        if code == 401:
            raise ExtractionError("requires_login")
        if code == 403:
            raise ExtractionError("access_denied")
        if code == 429:
            raise ExtractionError("rate_limited")
        if code != 200:
            raise ExtractionError("http_error")
        return parse_page(body, headers.get("content-type", ""))
    raise ExtractionError("too_many_redirects")
