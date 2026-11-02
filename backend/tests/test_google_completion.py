"""Landing-page styling may not weaken OAuth response isolation."""

import base64
import hashlib

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.google_completion import STYLE


@pytest.mark.parametrize(
    "result",
    [
        "connected",
        "cancelled",
        "insufficient_scope",
        "refresh_token_missing",
        "unknown",
        "",
    ],
)
def test_branded_completion_is_fixed_and_script_free(result):
    with TestClient(app) as client:
        response = client.get(
            "/api/integrations/google-calendar/complete", params={"result": result}
        )
    assert response.status_code == 200
    assert 'class="brand"' in response.text
    assert 'name="viewport"' in response.text
    assert 'href="/settings/google-calendar"' in response.text
    assert "<script" not in response.text and "http-equiv" not in response.text
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["referrer-policy"] == "no-referrer"
    digest = base64.b64encode(hashlib.sha256(STYLE.encode()).digest()).decode()
    assert (
        "style-src 'sha256-" + digest + "'"
        in response.headers["content-security-policy"]
    )
    assert "unsafe-inline" not in response.headers["content-security-policy"]


def test_unknown_result_and_provider_input_are_not_rendered():
    with TestClient(app) as client:
        response = client.get(
            "/api/integrations/google-calendar/complete",
            params={
                "result": '<img src=x onerror="alert(1)">',
                "code": "NEVER-ECHO-CODE",
                "error_description": "NEVER-ECHO-ERROR",
            },
        )
    assert "구글 연결을 완료하지 못했어요" in response.text
    assert "NEVER-ECHO" not in response.text and "onerror" not in response.text
    assert "연결됨" not in response.text
