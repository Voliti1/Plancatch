"""Static HTML review, date choices and recovery; no external requests."""
import uuid

import pytest

from app.models import Analysis, Source
from app.services import extraction
from app.services.ai_analysis import content_hash
from app.services.url_deadlines import (
    analyze_url,
    append_snapshot,
    collect_review,
    date_choice,
    review_data,
)
from tests.test_auth import TestingSession
from tests.test_html_analysis import forbid_ai, source_ready
from tests.test_sources import auth_headers, client, configure_test_jwt  # noqa: F401

URL = "https://example.com/notice"


def snapshot(html):
    doc = extraction.parse_page(html.encode(), "text/html", URL)
    return append_snapshot(doc.text, URL, URL, doc.review)


@pytest.mark.parametrize("raw,expected", [
    ("2026.11.03 23:59", "2026-11-03T23:59:00+09:00"),
    ("2026.11.05(목)", "2026-11-05T23:59:00+09:00"), ("2026.10.31", "2026-10-31T23:59:00+09:00"),
    ("~ 10.28(수) 14시", None),
    ("2026-11-03T23:59:00Z", "2026-11-03T23:59:00+00:00"),
    ("2026-11-03T23:59:01.123Z", "2026-11-03T23:59:01.123000+00:00"),
    ("2026.11.03 14시 30분", "2026-11-03T14:30:00+09:00"),
    ("2026.02.30 23:59", None), ("2026.11.03 24:59", None),
])
def test_dates_preserve_clocks_and_default_only_missing_clocks(raw, expected):
    choice = date_choice(raw, raw)
    assert choice is not None and choice["due_at"] == expected


def test_scoped_primary_notice_excludes_related_footer_and_later_articles():
    text = snapshot("""<article>회사 공고<p>마감일 2026.11.03 23:59</p>
      <aside>마감일 2026.12.01 18:00</aside>
      <div class="recommended-jobs">마감일 2026.12.02 18:00</div></article>
      <article>다른 공고 마감일 2026.12.03 18:00</article>
      <footer>마감일 2026.12.04 18:00</footer>""")
    data = review_data(text, URL)
    assert [c["raw_text"] for c in data["choices"]] == ["2026.11.03 23:59"]
    assert analyze_url(text, URL, "내 제목").deadlines[0].due_at is not None
    assert review_data(text, URL + "2") is None


def test_unscoped_body_is_manual_only_and_multiple_dates_remain_choices():
    text = snapshot("<div>공고 마감일 2026.11.03 23:59</div>")
    assert review_data(text)["choices"] == []
    assert analyze_url(text, URL, None).deadlines[0].due_at is None
    text = snapshot("<main>마감일 2026.11.03 23:59 또는 2026.11.04 18:00</main>")
    assert len(review_data(text)["choices"]) == 2
    assert analyze_url(text, URL, None).deadlines[0].due_at is None


def test_range_ignores_opening_date_and_open_ended_never_invents_deadline():
    data = collect_review("접수기간 2026.10.01 00:00 ~ 2026.11.03 23:59", "")
    assert [c["raw_text"] for c in data["choices"]] == ["2026.11.03 23:59"]
    text = snapshot("<main>마감일 채용 시 마감</main>")
    assert review_data(text)["open_ended"]
    assert analyze_url(text, URL, None).deadlines[0].due_at is None
    data = collect_review("마감일 채용시까지", "마감일 (validThrough): 2099-12-31T23:59")
    assert data["open_ended"]


def test_malformed_or_duplicate_snapshots_fail_closed():
    text = snapshot("<main>마감일 2026.11.03 23:59</main>")
    assert review_data(text + text) is None
    assert review_data(text.replace('"choices": [', '"choices": null,')) is None


def test_conflicting_saramin_period_keeps_read_date_but_requires_user_choice():
    from tests import test_saramin_period as period_fixture
    saramin_url = period_fixture.URL
    doc = extraction.parse_page(period_fixture.markup(start="2026.12.01 00:00").encode(), "text/html", saramin_url)
    text = append_snapshot(doc.text, saramin_url, saramin_url, doc.review)
    assert len(review_data(text)["choices"]) == 1
    assert analyze_url(text, saramin_url, "제목").deadlines[0].due_at is None


def test_url_runs_without_ai_and_requires_review_then_idempotent_approval(monkeypatch):
    forbid_ai(monkeypatch)
    text = snapshot("<main>마감일 2026.11.03 23:59</main>")
    source, headers = source_ready(text, URL)
    response = client.post(f"/api/sources/{source}/ai-analyses", headers=headers, json={})
    assert response.status_code == 202
    path = f"/api/ai-analyses/{response.json()['id']}"
    result = client.get(path, headers=headers).json()
    assert result["model"] == "html:url:v1" and result["status"] == "ready"
    assert len(result["date_choices"]) == 1
    assert client.get("/api/deadlines", headers=headers).json() == []
    assert client.post(path + "/auto-register", headers=headers, json={
        "revision": 1, "title": "제목", "confirm_auto_registration": True,
    }).status_code == 422
    first = client.post(path + "/approve", headers=headers, json={"revision": 1})
    again = client.post(path + "/approve", headers=headers, json={"revision": 1})
    assert first.status_code == again.status_code == 200
    assert first.json()["approved_deadline_ids"] == again.json()["approved_deadline_ids"]


def test_open_ended_requires_manual_date_before_approval(monkeypatch):
    forbid_ai(monkeypatch)
    source, headers = source_ready(snapshot("<main>마감일 채용시까지</main>"), URL)
    created = client.post(f"/api/sources/{source}/ai-analyses", headers=headers, json={}).json()
    path = f"/api/ai-analyses/{created['id']}"
    data = client.get(path, headers=headers).json()
    assert data["is_open_ended"] and data["candidates"][0]["due_at"] is None
    assert client.post(path + "/approve", headers=headers, json={"revision": 1}).status_code == 422
    candidate = data["candidates"][0]
    edit = {key: candidate[key] for key in ("id", "title", "due_at", "description", "selected")}
    edit.update(due_at="2026-11-05T14:00:00+09:00", selected=True)
    reviewed = client.patch(path, headers=headers, json={"revision": 1, "candidates": [edit]})
    assert reviewed.status_code == 200
    assert client.post(path + "/approve", headers=headers, json={"revision": 2}).status_code == 200


def test_failed_analysis_recovery_preserves_history_and_reuses_new_review(monkeypatch):
    forbid_ai(monkeypatch)
    text = snapshot("<main>마감일 2026.11.03 23:59</main>")
    source, headers = source_ready(text, URL)
    with TestingSession() as db:
        src = db.get(Source, uuid.UUID(source))
        failed = Analysis(user_id=src.user_id, source_id=src.id, input_text=text,
                          input_hash=content_hash(text), model="legacy-ai", status="failed",
                          error_message="ai_evidence_not_in_source")
        db.add(failed)
        db.commit()
        path = f"/api/ai-analyses/{failed.id}"
    assert client.post(path + "/recover-html").status_code == 401
    other = auth_headers(f"other-{uuid.uuid4().hex}@example.com")
    assert client.post(path + "/recover-html", headers=other).status_code == 404
    first = client.post(path + "/recover-html", headers=headers)
    again = client.post(path + "/recover-html", headers=headers)
    assert first.status_code == again.status_code == 202
    assert first.json()["id"] == again.json()["id"]
    assert client.get(path, headers=headers).json()["status"] == "failed"
    assert client.get(f"/api/ai-analyses/{first.json()['id']}", headers=headers).json()["status"] == "ready"
    client.patch(f"/api/sources/{source}", headers=headers, json={"original_url": URL + "2"})
    assert client.post(path + "/recover-html", headers=headers).status_code == 409
