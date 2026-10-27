"""Catch closing-period extraction and review, using synthetic HTML and SQLite."""
import json
from datetime import datetime

import pytest
from sqlalchemy import event

from app.models.deadline import Deadline
from app.services import catch_period as period, extraction
from app.services.url_deadlines import analyze_url, append_snapshot, review_data
from tests.test_html_analysis import forbid_ai, source_ready
from tests.test_sources import client, configure_test_jwt  # noqa: F401

URL = "https://www.catch.co.kr/NCS/RecruitInfoDetails/574650"
DUE = "2026-10-29T14:00:00+09:00"
TITLE = "[테스트기업] 2026년 채용설명회"


def markup(raw="~ 10.29(목) 14시", metadata=DUE, identity="574650", canonical=URL,
           heading="2026년 채용설명회", extra_postings=(), extra_html="", wrapper=""):
    posting = {"@type": "JobPosting", "title": TITLE, "validThrough": metadata}
    schema = ([] if metadata is None else [posting]) + list(extra_postings)
    blocks = ''.join('<script type="application/ld+json">' + json.dumps(item) + '</script>' for item in schema)
    link = f'<link rel="canonical" href="{canonical}">' if canonical else ''
    return (f'<html><head>{link}{blocks}</head><body><h1 class="subj">{heading}</h1>'
            + f'<div {wrapper}><div id="view2_{identity}" class="recr_pop_dday">'
            + f'<p class="t1"><span>{raw}<!----></span></p>'
            + '<p class="t2">2일 남았어요! 서두르세요!</p></div></div>'
            + extra_html + '</body></html>')


def snapshot(html=None, url=URL):
    doc = extraction.parse_page((html or markup()).encode(), "text/html", url)
    return append_snapshot(doc.text, url, url, doc.review)


def test_same_page_partial_label_and_complete_metadata_resolve_without_js_or_timer_arithmetic():
    text = snapshot()
    info = period.read_period(text)
    assert info["site"] == "catch" and info["end_text"] == "~ 10.29(목) 14시"
    assert info["deadline_at"].isoformat() == DUE and not info["has_conflict"]
    assert info["remaining_text"] is None
    result = analyze_url(text, URL, "[테스트] 캐치 지원")
    assert result.deadlines[0].due_at.isoformat() == DUE and result.warnings == []
    assert "~ 10.29(목) 14시" in result.deadlines[0].evidence_text
    assert DUE in result.deadlines[0].evidence_text
    assert result.deadlines[0].evidence_text in text
    assert text.count(period.MARKER) == text.count(period.END_MARKER) == 1
    assert review_data(text, URL)["choices"][0]["due_at"] == DUE


@pytest.mark.parametrize("metadata", ["2026-10-29T05:00:00Z", "2026-10-29T14:00:00", "2037-10-29T14:00:00+09:00"])
def test_explicit_metadata_year_and_timezone_are_used_instead_of_current_year(metadata):
    result = analyze_url(snapshot(markup(metadata=metadata)), URL, None)
    expected = metadata if metadata[-6] in "+-" or metadata.endswith("Z") else metadata + "+09:00"
    assert result.deadlines[0].due_at == datetime.fromisoformat(expected)


@pytest.mark.parametrize("raw", ["~ 10.28(목) 14시", "~ 10.29(금) 14시", "~ 10.29(목) 15시",
                                 "~ 2027.10.29(목) 14시", "~ 10.29(목) 14시30분"])
def test_visible_and_metadata_disagreement_never_prefills_a_deadline(raw):
    text = snapshot(markup(raw=raw))
    assert period.read_period(text)["has_conflict"]
    result = analyze_url(text, URL, None)
    assert result.deadlines[0].due_at is None and result.warnings == [period.CONFLICT]


@pytest.mark.parametrize("changes", [{"metadata": None}, {"canonical": None}, {"heading": "다른 공고"},
                                    {"raw": "~ 10.29(목)"}])
def test_missing_year_scope_or_visible_clock_remains_manual_confirmation(changes):
    text = snapshot(markup(**changes))
    assert period.read_period(text)["deadline_at"] is None
    result = analyze_url(text, URL, None)
    assert result.deadlines[0].due_at is None
    assert result.warnings == [period.UNRESOLVED]


def test_t2_only_relative_days_do_not_infer_a_deadline():
    text = snapshot(markup(raw="", metadata=None))
    assert analyze_url(text, URL, None).deadlines[0].due_at is None


@pytest.mark.parametrize("wrapper", ["hidden", 'style="display: none"', 'aria-hidden="true"'])
def test_hidden_period_does_not_supply_evidence(wrapper):
    assert period.read_period(snapshot(markup(wrapper=wrapper))) is None


def test_other_job_ids_metadata_references_and_recommendations_are_excluded():
    assert period.read_period(snapshot(markup(identity="999999"))) is None
    unrelated = {"@type": "JobPosting", "title": TITLE, "url": URL.replace("574650", "999999"),
                 "validThrough": "2037-10-29T14:00:00+09:00"}
    text = snapshot(markup(extra_postings=[unrelated], extra_html='<div id="view2_999999" class="recr_pop_dday"><p class="t1">~ 11.30(월) 23시</p></div>'))
    assert analyze_url(text, URL, None).deadlines[0].due_at.isoformat() == DUE
    outside = snapshot(markup(), url="https://example.com/NCS/RecruitInfoDetails/574650")
    assert period.read_period(outside) is None
    assert analyze_url(outside, "https://example.com/NCS/RecruitInfoDetails/574650", None).deadlines[0].due_at is None


def test_multiple_same_job_metadata_or_dom_periods_require_confirmation():
    other = {"@type": "JobPosting", "title": TITLE, "validThrough": "2026-11-01T14:00:00+09:00"}
    duplicate = '<div id="view2_574650" class="recr_pop_dday"><p class="t1">~ 10.29(목) 14시</p></div>'
    for html in [markup(extra_postings=[other]), markup(extra_html=duplicate), markup(canonical=URL.replace("574650", "999999"))]:
        text = snapshot(html)
        assert period.read_period(text)["has_conflict"]
        assert analyze_url(text, URL, None).deadlines[0].due_at is None


def test_open_ended_and_invalid_metadata_are_review_only():
    text = snapshot(markup(raw="채용 시 마감"))
    assert review_data(text, URL)["open_ended"]
    assert analyze_url(text, URL, None).deadlines[0].due_at is None
    assert period.read_period(snapshot(markup(metadata="2026-02-30T14:00:00+09:00")))["has_conflict"]


def test_snapshot_validation_and_bounded_capture():
    text = snapshot()
    assert period.read_period(text + text) is None
    assert period.read_period(text.replace("마감일 (정규화): " + DUE, "마감일 (정규화): 2037-01-01T00:00:00Z"))["has_conflict"]
    assert period.read_period(snapshot(markup(raw="~ 10.29(목) 14시" + " " * 300)))["has_conflict"]


def test_review_edit_approve_refresh_and_retry_preserve_catch_time(monkeypatch):
    forbid_ai(monkeypatch)
    source, headers = source_ready(snapshot(), URL)
    started = client.post(f"/api/sources/{source}/ai-analyses", headers=headers, json={})
    assert started.status_code == 202
    path = f"/api/ai-analyses/{started.json()['id']}"
    analysis = client.get(path, headers=headers).json()
    assert analysis["status"] == "ready" and analysis["model"] == "html:url:v1"
    assert analysis["source_period"]["site"] == "catch"
    assert analysis["candidates"][0]["due_at"] == DUE
    assert client.get("/api/deadlines", headers=headers).json() == []
    candidate = {key: analysis["candidates"][0][key] for key in ("id", "title", "due_at", "description", "selected")}
    candidate["title"] = "[테스트] 캐치 채용설명회"
    edited = client.patch(path, headers=headers, json={"revision": 1, "candidates": [candidate]})
    assert edited.status_code == 200 and edited.json()["revision"] == 2
    inserted = []
    def capture(_mapper, _connection, item):
        inserted.append(item.due_at.isoformat())
    event.listen(Deadline, "before_insert", capture)
    try:
        first = client.post(path + "/approve", headers=headers, json={"revision": 2})
        again = client.post(path + "/approve", headers=headers, json={"revision": 2})
    finally:
        event.remove(Deadline, "before_insert", capture)
    assert first.status_code == again.status_code == 200
    assert first.json()["approved_deadline_ids"] == again.json()["approved_deadline_ids"]
    assert client.get(path, headers=headers).json()["status"] == "approved"
    assert len(client.get("/api/deadlines", headers=headers).json()) == 1
    assert inserted == [DUE]  # SQLite itself drops offsets; check the persisted input.
