"""Exercise the real HTTPResponse end-of-body behavior without any network/AI call."""
import http.client
import io
from types import SimpleNamespace

import pytest
from pydantic import SecretStr

from app.services import ai_analysis


def transport(monkeypatch, wire):
    raw = io.BytesIO(wire)
    raw._sock = SimpleNamespace(settimeout=lambda _: None)
    response = http.client.HTTPResponse(SimpleNamespace(makefile=lambda _: io.BufferedReader(raw)))
    response.begin()
    closed = []
    fake = SimpleNamespace(request=lambda *args, **kwargs: None,
                           getresponse=lambda: response, close=lambda: closed.append(True))
    monkeypatch.setattr(ai_analysis.http.client, "HTTPSConnection", lambda *a, **kw: fake)
    monkeypatch.setattr(ai_analysis, "get_settings", lambda: SimpleNamespace(
        gemini_api_key=SecretStr("test-only-key")))
    return closed


@pytest.mark.parametrize("chunked", [False, True])
def test_valid_response_is_not_read_after_httpresponse_closes(monkeypatch, chunked):
    body = b'{"candidates":[]}'
    if chunked:
        wire = b'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n' + format(len(body), 'x').encode() + b'\r\n' + body + b'\r\n0\r\n\r\n'
    else:
        wire = b'HTTP/1.1 200 OK\r\nContent-Length: ' + str(len(body)).encode() + b'\r\n\r\n' + body
    closed = transport(monkeypatch, wire)
    assert ai_analysis.provider_request({}, "test-model") == {"candidates": []}
    assert closed == [True]


@pytest.mark.parametrize("length,body,code", [
    (0, b'', 'ai_invalid_result'),
    (20, b'{}', 'ai_network_error'),
    (2_000_001, b' ' * 2_000_001, 'ai_response_too_large'),
], ids=["empty", "truncated", "oversized"])
def test_empty_truncated_and_oversized_bodies_fail_with_safe_codes(monkeypatch, length, body, code):
    closed = transport(monkeypatch, b'HTTP/1.1 200 OK\r\nContent-Length: ' + str(length).encode() + b'\r\n\r\n' + body)
    with pytest.raises(ai_analysis.AIError, match=code):
        ai_analysis.provider_request({}, "test-model")
    assert closed == [True]
