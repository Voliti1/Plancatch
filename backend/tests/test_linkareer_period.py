"""Linkareer date fields and explicit metadata time; synthetic HTML and SQLite."""
import json
from datetime import datetime

import pytest
from sqlalchemy import event

from app.models.deadline import Deadline
from app.services import extraction
from app.services import linkareer_period as period
from app.services.url_deadlines import analyze_url, append_snapshot, review_data
from tests.test_html_analysis import forbid_ai, source_ready
from tests.test_sources import client, configure_test_jwt  # noqa: F401

URL = "https://linkareer.com/activity/356174"
TITLE = "[테스트기업] 전 직군 채용"
META = "2026-10-31T14:59:59.999Z"
DUE = datetime.fromisoformat(META)


def markup(start="2026.10.12", end="2026.10.31", metadata=META, canonical=URL,
           heading=TITLE, extra_postings=(), extra="", wrapper=""):
    posting = {"@type": "JobPosting", "title": TITLE, "validThrough": metadata,
               "identifier": {"propertyID": "사업자등록번호", "value": "111-22-33333"}}
    data = ([] if metadata is None else [posting]) + list(extra_postings)
    scripts = ''.join('<script type="application/ld+json">' + json.dumps(item) + '</script>' for item in data)
    link = f'<link rel="canonical" href="{canonical}">' if canonical else ''
    return (f'<html><head>{link}{scripts}</head><body><header><h1>{heading}</h1></header>'
            + f'<article><p>공개 채용 본문</p><div {wrapper}><dl><dt>접수기간</dt><dd class="text">'
            + f'<div><span class="start-at">시작일</span><span>{start}</span></div>'
            + f'<span class="end-at">마감일</span><span>{end}</span></dd></dl></div>{extra}</article></body></html>')


def snapshot(html=None, url=URL):
    doc = extraction.parse_page((html or markup()).encode(), "text/html", url)
    return append_snapshot(doc.text, url, url, doc.review)


def test_date_fields_and_metadata_expiry_keep_fraction_and_explain_the_time_source():
    text = snapshot()
    info = period.read_period(text)
    assert info["site"] == "linkareer" and not info["has_conflict"]
    assert info["start_text"] == "2026.10.12" and info["end_text"] == "2026.10.31"
    assert info["deadline_at"] == DUE and info["time_from_metadata"]
    assert DUE.astimezone(period.SEOUL).isoformat() == "2026-10-31T23:59:59.999000+09:00"
    result = analyze_url(text, URL, None)
    assert result.deadlines[0].due_at == DUE
    assert result.warnings == [period.METADATA_TIME]
    assert result.deadlines[0].evidence_text == "마감일 원문: 2026.10.31\n공고 메타데이터 마감일: " + META
    assert result.deadlines[0].evidence_text in text
    assert len(review_data(text, URL)["choices"]) == 1
    assert text.count(period.MARKER) == text.count(period.END_MARKER) == 1


def test_html_strategy_keeps_metadata_even_when_an_image_alternative_mentions_a_clock(monkeypatch):
    forbid_ai(monkeypatch)
    url = "https://linkareer.com/activity/357927"
    text = snapshot(markup(start="2026.11.03", end="2026.11.09", canonical=url,
                           metadata="2026-11-09T14:59:59.999Z",
                           extra='<img src="/notice.png" alt="입사지원서 접수 11.9.(월) 18:00까지">'), url)
    result = analyze_url(text, url, None)
    assert result.deadlines[0].due_at.isoformat() == "2026-11-09T14:59:59.999000+00:00"
    assert result.warnings == [period.METADATA_TIME]


@pytest.mark.parametrize("metadata", [None, "2026-10-31"])
def test_date_only_without_metadata_clock_uses_reviewed_end_of_day_default(metadata):
    text = snapshot(markup(metadata=metadata))
    info = period.read_period(text)
    assert info["deadline_at"] is None and not info["has_conflict"]
    result = analyze_url(text, URL, None)
    assert result.deadlines[0].due_at.isoformat() == "2026-10-31T23:59:00+09:00"
    assert any("11시 59분" in item for item in result.warnings)
    assert review_data(text, URL)["choices"][0]["date"] == "2026-10-31"


def test_explicit_visible_clock_matches_metadata_without_date_only_notice():
    result = analyze_url(snapshot(markup(end="2026.10.31 23:59")), URL, None)
    assert result.deadlines[0].due_at == DUE and result.warnings == []


@pytest.mark.parametrize("changes", [{"metadata": "2026-10-31T15:00:00Z"},
                                    {"metadata": "2026-10-30T14:59:59Z"},
                                    {"metadata": "2026-10-31T23:59:59"},
                                    {"metadata": "2026-02-30T23:59:59+09:00"},
                                    {"start": "2026.11.01"}, {"start": "2026.02.30"},
                                    {"end": "2026.10.31 18:00"}, {"canonical": None},
                                    {"canonical": URL.replace("356174", "999999")},
                                    {"extra": '<h1>다른 제목</h1>'}, {"end": "2026.10.31" + " " * 250}])
def test_conflicting_scope_dates_or_clocks_are_not_prefilled(changes):
    text = snapshot(markup(**changes))
    assert period.read_period(text)["has_conflict"]
    result = analyze_url(text, URL, None)
    assert result.deadlines[0].due_at is None and result.warnings == [period.CONFLICT]
    assert all(item["due_at"] is None for item in review_data(text, URL)["choices"])


@pytest.mark.parametrize("wrapper", ["hidden", 'aria-hidden="true"', 'style="display:none"'])
def test_hidden_fields_are_not_evidence(wrapper):
    assert period.read_period(snapshot(markup(wrapper=wrapper))) is None


def test_other_posting_metadata_is_not_the_current_job():
    other = {"@type": "JobPosting", "title": TITLE, "url": URL.replace("356174", "999999"),
             "validThrough": "2030-12-31T14:59:59Z"}
    assert analyze_url(snapshot(markup(extra_postings=[other])), URL, None).deadlines[0].due_at == DUE
    no_current = snapshot(markup(metadata=None, extra_postings=[other]))
    assert analyze_url(no_current, URL, None).deadlines[0].due_at.isoformat() == "2026-10-31T23:59:00+09:00"
    wrong_title = snapshot(markup(heading="다른 공고"))
    # Visible date remains usable under the new default policy, but the
    # unrelated metadata's 23:59:59.999 clock must not be borrowed.
    assert analyze_url(wrong_title, URL, None).deadlines[0].due_at.isoformat() == "2026-10-31T23:59:00+09:00"
    assert period.period_text(markup(), "https://example.com/activity/356174") == ""


def test_duplicate_periods_or_metadata_and_navigation_title_fail_closed():
    other = {"@type": "JobPosting", "title": TITLE, "validThrough": "2030-12-31T14:59:59Z"}
    duplicate = '<dl><dt>접수기간</dt><dd><div><span class="start-at">시작일</span><span>2026.10.12</span></div><span class="end-at">마감일</span><span>2026.10.31</span></dd></dl>'
    for html in [markup(extra_postings=[other]), markup(extra=duplicate),
                 markup().replace('<header>', '<nav>').replace('</header>', '</nav>')]:
        text = snapshot(html)
        assert period.read_period(text)["has_conflict"]
        assert analyze_url(text, URL, None).deadlines[0].due_at is None


def test_wrong_field_labels_and_snapshot_mutation():
    assert period.read_period(snapshot(markup().replace('<dt>접수기간</dt>', '<dt>활동기간</dt>'))) is None
    text = snapshot()
    assert period.read_period(text + text) is None
    assert period.read_period(text.replace('마감일 (정규화): ' + DUE.isoformat(), '마감일 (정규화): 2026-10-31T00:00:00Z'))["has_conflict"]


def test_api_title_edit_approval_retry_and_reload_preserve_the_metadata_instant(monkeypatch):
    forbid_ai(monkeypatch)
    source, headers = source_ready(snapshot(), URL)
    response = client.post(f"/api/sources/{source}/ai-analyses", headers=headers, json={})
    assert response.status_code == 202
    path = f"/api/ai-analyses/{response.json()['id']}"
    analysis = client.get(path, headers=headers).json()
    assert analysis["status"] == "ready" and analysis["model"] == "html:url:v1"
    assert analysis["source_period"]["site"] == "linkareer"
    assert datetime.fromisoformat(analysis["candidates"][0]["due_at"]) == DUE
    assert analysis["warnings"] == [period.METADATA_TIME]
    assert client.get("/api/deadlines", headers=headers).json() == []
    candidate = {key: analysis["candidates"][0][key] for key in ("id", "title", "due_at", "description", "selected")}
    candidate["title"] = "[테스트] 링커리어 지원"
    saved = client.patch(path, headers=headers, json={"revision": 1, "candidates": [candidate]})
    assert saved.status_code == 200 and saved.json()["revision"] == 2
    inserted = []
    def capture(_mapper, _connection, item):
        inserted.append(item.due_at)
    event.listen(Deadline, "before_insert", capture)
    try:
        first = client.post(path + "/approve", headers=headers, json={"revision": 2})
        again = client.post(path + "/approve", headers=headers, json={"revision": 2})
    finally:
        event.remove(Deadline, "before_insert", capture)
    assert first.status_code == again.status_code == 200
    assert first.json()["approved_deadline_ids"] == again.json()["approved_deadline_ids"]
    assert len(client.get("/api/deadlines", headers=headers).json()) == 1
    assert inserted == [DUE] and inserted[0].microsecond == 999000
    assert client.get(path, headers=headers).json()["status"] == "approved"
