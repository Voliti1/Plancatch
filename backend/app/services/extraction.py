"""Bounded, public-only single-page extraction; never uses user cookies."""

import http.client
import ipaddress
import json
import re
import socket
import ssl
import time
from dataclasses import dataclass
from datetime import date, datetime
from html.parser import HTMLParser
from urllib.parse import parse_qs, parse_qsl, urljoin, urlsplit, urlunsplit
from urllib.robotparser import RobotFileParser

MAX_BYTES = 2_000_000
MAX_TEXT = 100_000
MAX_JSON_LD = 100_000
MAX_JSON_LD_BLOCKS = 16
STRUCTURED_DATE_NOTICES = (
    "주의: 원문에는 마감 날짜만 있고 시간과 시간대가 없습니다. 사용자 확인이 필요합니다.",
    # Keep the old notice recognizable for already stored source snapshots.
    "주의: 원문 마감일에 시간대가 명시되지 않았습니다. 사용자 확인이 필요합니다.",
)
DEFAULT_TIMEZONE_POLICY = (
    "서비스 처리 기준: 날짜와 시간이 있고 시간대만 없으면 한국 시간(Asia/Seoul, UTC+09:00)으로 처리합니다."
)
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
        # Text exclusions (navigation) are distinct from unrendered elements.
        # A visible password input in a header still represents a login gate.
        self.stack: list[tuple[str, bool, bool]] = []
        self.body: list[str] = []
        self.main: list[str] = []
        self.title: list[str] = []
        self.password_form = False
        self.canonical_links: list[str] = []
        self.json_ld_blocks: list[str] = []
        self.json_ld_current: list[str] | None = None
        self.json_ld_characters = 0
        self.json_ld_overflow = False

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if (tag == "script" and (values.get("type") or "").strip().lower() == "application/ld+json"
                and "src" not in values and not any(skip for _, skip, _ in self.stack)
                and "hidden" not in values and (values.get("aria-hidden") or "").lower() != "true"
                and not hidden_inline_style(values.get("style") or "")
                and len(self.json_ld_blocks) < MAX_JSON_LD_BLOCKS):
            # Capture inert structured data separately, never arbitrary JS or
            # metadata inside hidden/login/navigation containers.
            self.json_ld_current = []
            self.json_ld_overflow = False
        unrendered = (tag in {"script", "style", "template", "noscript"}
                      or "hidden" in values or (values.get("aria-hidden") or "").lower() == "true"
                      or hidden_inline_style(values.get("style") or "")
                      or any(hidden for _, _, hidden in self.stack))
        if tag == "input" and (values.get("type") or "").lower() == "password" and not unrendered:
            self.password_form = True
        if (tag == "link" and "canonical" in (values.get("rel") or "").lower().split()
                and any(name == "head" for name, _, _ in self.stack) and values.get("href")):
            self.canonical_links.append(values["href"])
        hidden = (unrendered or tag in {"nav", "footer", "header"}
                  or any(skip for _, skip, _ in self.stack))
        if tag not in {"area", "base", "br", "col", "embed", "hr", "img", "input",
                       "link", "meta", "param", "source", "track", "wbr"}:
            self.stack.append((tag, hidden, unrendered))

    def handle_endtag(self, tag):
        if tag == "script" and self.json_ld_current is not None:
            if not self.json_ld_overflow:
                self.json_ld_blocks.append("".join(self.json_ld_current))
            self.json_ld_current = None
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break

    def handle_data(self, data):
        if self.json_ld_current is not None:
            self.json_ld_characters += len(data)
            if self.json_ld_characters <= MAX_JSON_LD:
                self.json_ld_current.append(data)
            else:
                self.json_ld_current.clear()
                self.json_ld_overflow = True
            return
        text = " ".join(data.split())
        if not text:
            return
        if any(tag == "title" for tag, _, _ in self.stack):
            self.title.append(text)
        elif not any(skip for _, skip, _ in self.stack):
            self.body.append(text)
            if any(tag in {"main", "article"} for tag, _, _ in self.stack):
                self.main.append(text)


def hidden_inline_style(style: str) -> bool:
    """Recognize explicit hiding only; never infer it from arbitrary CSS classes."""
    properties: dict[str, tuple[str, bool]] = {}
    style = re.sub(r"/\*.*?\*/", "", style, flags=re.DOTALL)
    for declaration in style.split(";"):
        key, separator, value = declaration.partition(":")
        if not separator:
            continue
        key, value = key.strip().lower(), value.strip().lower()
        important = re.search(r"!\s*important\s*$", value) is not None
        if important:
            value = re.sub(r"!\s*important\s*$", "", value).strip()
        if key not in properties or important or not properties[key][1]:
            properties[key] = (value, important)
    return (properties.get("display", ("", False))[0] == "none"
            or properties.get("visibility", ("", False))[0] in {"hidden", "collapse"})


def decode_page(body: bytes, content_type: str) -> str:
    charset = "utf-8"
    for parameter in content_type.split(";")[1:]:
        if parameter.strip().lower().startswith("charset="):
            charset = parameter.split("=", 1)[1].strip().strip('"')
    try:
        return body.decode(charset, errors="replace")
    except LookupError as exc:
        raise ExtractionError("unsupported_encoding") from exc


def same_job_page(reference: str, source_url: str) -> bool:
    """Compare identities only; never follow or fetch a metadata URL."""
    try:
        source, target = urlsplit(source_url), urlsplit(urljoin(source_url, reference))
        if (not reference.strip() or any(ord(char) < 32 for char in reference)
                or target.scheme not in {"http", "https"}
                or target.username is not None or target.password is not None):
            return False
        def identity(parts):
            return (parts.scheme, parts.hostname, parts.port or (443 if parts.scheme == "https" else 80),
                    parts.path or "/")
        if identity(source) != identity(target):
            return False
        source_query = sorted(parse_qsl(source.query, keep_blank_values=True, max_num_fields=100))
        target_query = sorted(parse_qsl(target.query, keep_blank_values=True, max_num_fields=100))
        # JobKorea's numeric path identifies a job; submitted search/tracking
        # queries are not present in its metadata URL. No generic query removal.
        if (source.hostname in {"www.jobkorea.co.kr", "jobkorea.co.kr"}
                and re.fullmatch(r"/Recruit/GI_Read/[0-9]{1,20}", source.path)
                and not target_query):
            return True
        return source_query == target_query
    except ValueError:
        return False


def job_postings(blocks: list[str]) -> list[dict]:
    """Only traverse top-level lists/@graph, with a bounded inert JSON walk."""
    postings = []
    for block in blocks:
        try:
            pending = [(json.loads(block), 0)]
        except (ValueError, RecursionError):
            continue
        visited, current = 0, []
        while pending:
            value, depth = pending.pop()
            visited += 1
            if visited > 128 or depth > 8:
                current = []  # Do not trust a partially inspected graph.
                break
            if isinstance(value, list):
                if len(value) > 128:
                    current = []
                    break
                pending.extend((item, depth + 1) for item in value)
            elif isinstance(value, dict):
                types = value.get("@type", [])
                if isinstance(types, str):
                    types = [types]
                if isinstance(types, list) and any(item in (
                    "JobPosting", "https://schema.org/JobPosting", "http://schema.org/JobPosting",
                ) for item in types):
                    current.append(value)
                graph = value.get("@graph")
                if isinstance(graph, (list, dict)):
                    pending.append((graph, depth + 1))
        postings.extend(current)
    return postings


def structured_job_text(blocks: list[str], source_url: str | None) -> str:
    """Expose same-page JobPosting evidence, without inventing dates/timezones."""
    if not source_url:
        return ""
    matching = []
    for item in job_postings(blocks):
        references = [item[key] for key in ("url", "@id") if key in item]
        if not references:
            reference = item.get("mainEntityOfPage")
            references = [reference.get("@id") if isinstance(reference, dict) else reference]
        if not all(isinstance(ref, str) and same_job_page(ref, source_url) for ref in references):
            continue
        source = urlsplit(source_url)
        if (source.hostname in {"www.jobkorea.co.kr", "jobkorea.co.kr"}
                and re.fullmatch(r"/Recruit/GI_Read/[0-9]{1,20}", source.path)
                and "identifier" in item):
            identifier = item["identifier"]
            value = identifier.get("value") if isinstance(identifier, dict) else identifier
            if str(value) != source.path.rsplit("/", 1)[1]:
                continue
        matching.append(item)
    # Multiple incompatible records cannot establish one deadline. Identical
    # duplicates are harmless. Do not mix in related jobs or advertisement dates.
    unique = {json.dumps({key: item.get(key) for key in ("title", "validThrough", "description")},
                         sort_keys=True, ensure_ascii=False): item for item in matching}
    if len(unique) != 1:
        return ""
    item = next(iter(unique.values()))
    title, expires = item.get("title"), item.get("validThrough")
    if (not isinstance(title, str) or not title.strip() or len(title) > 1000
            or not isinstance(expires, str) or len(expires) > 80
            or not re.fullmatch(r"\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d"
                                r"(?::[0-5]\d(?:\.\d{1,6})?)?"
                                r"(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?", expires)):
        return ""
    try:
        parsed = datetime.fromisoformat(expires) if "T" in expires else date.fromisoformat(expires)
    except ValueError:
        return ""
    lines = ["[동일 페이지의 채용공고 구조화 데이터: JSON-LD JobPosting]",
             f"공고 제목: {' '.join(title.split())}", f"공고 URL: {source_url}",
             f"마감일 (validThrough): {expires}"]
    if not isinstance(parsed, datetime):
        lines.append(STRUCTURED_DATE_NOTICES[0])
    elif parsed.utcoffset() is None:
        lines.append(DEFAULT_TIMEZONE_POLICY)
    description = item.get("description")
    if isinstance(description, str):
        parser = PageParser()
        parser.feed(description)
        if not parser.password_form and (parser.main or parser.body):
            lines.extend(["공고 설명:", "\n".join(parser.main or parser.body)])
    text = "\n".join(lines)
    try:
        text.encode("utf-8")  # Reject invalid escaped surrogates before DB/AI storage.
    except UnicodeError:
        return ""
    return text


def parse_page(body: bytes, content_type: str, source_url: str | None = None) -> Document:
    media_type = content_type.split(";", 1)[0].strip().lower()
    decoded = decode_page(body, content_type)
    if media_type == "text/plain":
        text, title = decoded.strip(), None
    elif media_type in {"text/html", "application/xhtml+xml"}:
        parser = PageParser()
        parser.feed(decoded)
        # Visible password inputs remain a conservative gate heuristic. Hidden
        # optional login popups neither block public content nor enter AI input.
        if parser.password_form:
            raise ExtractionError("requires_login")
        text = "\n".join(parser.main or parser.body)
        job_text = structured_job_text(parser.json_ld_blocks, source_url)
        if job_text:
            text = "\n\n".join(part for part in (text, job_text) if part)
        title = " ".join(parser.title)[:255] or None
    else:
        raise ExtractionError("unsupported_content_type")
    if not text.strip():
        raise ExtractionError("empty_content_or_rendering_required")
    if len(text) > MAX_TEXT:
        raise ExtractionError("text_too_large")
    return Document(text, title)


def public_job_canonical(url: str, body: bytes, content_type: str) -> str | None:
    """Saramin relay shells link to a public, server-rendered version of the same job.

    This is a bounded site adapter, not a generic canonical/iframe crawler. The
    original document must already pass parse_page's login gate before calling.
    """
    source = urlsplit(url)
    if (source.hostname != "www.saramin.co.kr" or source.path != "/zf_user/jobs/relay/view"
            or content_type.split(";", 1)[0].strip().lower() not in {"text/html", "application/xhtml+xml"}):
        return None
    try:
        source_ids = parse_qs(source.query, keep_blank_values=True, max_num_fields=30).get("rec_idx", [])
        if len(source_ids) != 1 or not re.fullmatch(r"[0-9]{1,20}", source_ids[0]):
            return None
        parser = PageParser()
        parser.feed(decode_page(body, content_type))
        # Conflicting canonical declarations cannot establish a single identity.
        targets = {urljoin(url, href) for href in parser.canonical_links}
        if len(targets) != 1:
            return None
        target = urlsplit(targets.pop())
        target_query = parse_qs(target.query, keep_blank_values=True, max_num_fields=30)
        if (target.scheme != source.scheme or target.hostname != source.hostname
                or (target.port or (443 if target.scheme == "https" else 80))
                != (source.port or (443 if source.scheme == "https" else 80))
                or target.username is not None or target.password is not None
                or target.path != "/zf_user/jobs/view"
                or target_query != {"rec_idx": source_ids}):
            return None
        return urlunsplit((target.scheme, target.netloc, target.path, target.query, ""))
    except ValueError:
        return None


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
    canonical_followed = False
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
        content_type = headers.get("content-type", "")
        document = parse_page(body, content_type, url)  # Never leave an actual login gate.
        canonical = None if canonical_followed else public_job_canonical(url, body, content_type)
        if canonical:
            canonical_followed = True
            url = canonical
            # The next iteration checks robots/public DNS/TLS/limits again.
            continue
        return document
    raise ExtractionError("too_many_redirects")
