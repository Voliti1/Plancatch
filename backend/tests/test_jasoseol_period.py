"""Same-job Jasoseol HTML/JSON clock verification, no live network or user DB."""
import json
from datetime import timezone

import pytest
from sqlalchemy import event

from app.models.deadline import Deadline
from app.services import extraction
from app.services import jasoseol_period as period
from app.services.url_deadlines import analyze_url, append_snapshot, review_data
from tests.test_html_analysis import forbid_ai, source_ready
from tests.test_sources import client, configure_test_jwt  # noqa: F401

URL = "https://jasoseol.com/recruit/106909"
START = "2026-10-26T18:00:00.000+09:00"
END = "2026-11-07T23:50:00.000+09:00"
DUE = "2026-11-07T23:50:00+09:00"


def next_data():
    return {"page": "/desktop/recruit/[slug]", "query": {"slug": "106909"}, "props": {"pageProps": {
        "employmentCompanyId": 106909,
        "initialEmploymentCompany": {"id": 106909, "title": "[테스트] 인사직무 채용", "start_time": START, "end_time": END},
        "popupAdvertises": [{"id": 999999, "start_time": "2030-01-01T00:00:00+09:00", "end_time": "2030-12-31T23:59:59+09:00"}],
    }}}


def markup(data=None, shown_start="2026년 10월 26일 09:00", shown_end="2026년 11월 7일 14:50",
           canonical=URL, wrapper="", extra="", script=True):
    payload = json.dumps(data if data is not None else next_data(), ensure_ascii=False)
    block = f'<script id="__NEXT_DATA__" type="application/json">{payload}</script>' if script else ''
    link = f'<link rel="canonical" href="{canonical}">' if canonical else ''
    return (f'<html><head>{link}</head><body><h1>[테스트] 인사직무 채용</h1><div {wrapper}>'
            + f'<div class="flex gap-[4px] mb-[12px] body5"><span>{shown_start}</span><span> ~ </span>'
            + f'<span>{shown_end}</span><span>(11일 남음)</span></div></div>{extra}{block}</body></html>')


def snapshot(html=None, url=URL):
    doc = extraction.parse_page((html or markup()).encode(), "text/html", url)
    return append_snapshot(doc.text, url, url, doc.review)


@pytest.mark.parametrize("shown_start,shown_end", [("2026년 10월 26일 09:00", "2026년 11월 7일 14:50"),
                                                ("2026년 10월 26일 18:00", "2026년 11월 7일 23:50")])
def test_utc_ssr_and_seoul_browser_pairs_use_the_same_explicit_offset(shown_start, shown_end):
    text = snapshot(markup(shown_start=shown_start, shown_end=shown_end))
    info = period.read_period(text)
    assert info["site"] == "jasoseol" and not info["has_conflict"]
    assert info["start_text"] == START and info["end_text"] == END
    assert info["deadline_at"].isoformat() == DUE
    assert info["remaining_text"] is None
    result = analyze_url(text, URL, "[테스트] 사용자가 정한 제목")
    assert result.deadlines[0].due_at.isoformat() == DUE and result.warnings == []
    assert result.deadlines[0].title == "[테스트] 사용자가 정한 제목"
    assert result.deadlines[0].evidence_text == f"마감일 원문: {END}"
    assert result.deadlines[0].evidence_text in text
    assert review_data(text, URL)["choices"][0]["due_at"] == DUE


@pytest.mark.parametrize("changes", [{"shown_start": "2026년 10월 26일 18:00"},
                                    {"shown_end": "2026년 11월 7일 23:50"},
                                    {"shown_end": "2026년 11월 7일 15:50"},
                                    {"shown_end": "2026년 11월 8일 14:50"},
                                    {"shown_end": "2026년 2월 30일 14:50"},
                                    {"canonical": None}, {"canonical": URL.replace("106909", "999999")},
                                    {"script": False}, {"shown_end": "2026년 11월 7일"}])
def test_mixed_or_unverified_periods_require_manual_confirmation(changes):
    text = snapshot(markup(**changes))
    assert period.read_period(text)["has_conflict"]
    result = analyze_url(text, URL, None)
    assert result.deadlines[0].due_at is None and result.warnings == [period.CONFLICT]
    assert all(item["due_at"] is None for item in review_data(text, URL)["choices"])


@pytest.mark.parametrize("field,value", [("slug", "999999"), ("employmentCompanyId", 999999), ("id", 999999),
                                      ("title", "다른 공고"), ("page", "/desktop/recruit"),
                                      ("start_time", "2026-10-26T18:00:00"),
                                      ("end_time", "2026-11-07T23:50:00"), ("end_time", None),
                                      ("end_time", "2026-10-25T23:50:00+09:00")])
def test_only_the_exact_initial_company_record_with_aware_dates_is_accepted(field, value):
    data = next_data()
    props = data["props"]["pageProps"]
    target = data if field == "page" else data["query"] if field == "slug" else props if field == "employmentCompanyId" else props["initialEmploymentCompany"]
    target[field] = value
    text = snapshot(markup(data=data))
    assert period.read_period(text)["has_conflict"]
    assert analyze_url(text, URL, None).deadlines[0].due_at is None


@pytest.mark.parametrize("wrapper", ["hidden", 'style="display:none"', 'aria-hidden="true"'])
def test_hidden_periods_do_not_supply_visible_evidence(wrapper):
    assert period.read_period(snapshot(markup(wrapper=wrapper))) is None


def test_duplicate_periods_scripts_keys_and_oversized_data_fail_closed(monkeypatch):
    extra = '<div class="flex gap-[4px] body5"><span>2026년 10월 26일 09:00</span><span>~</span><span>2026년 11월 7일 14:50</span></div>'
    cases = [markup(extra=extra), markup(extra='<h1>다른 제목</h1>'),
             markup(extra='<script id="__NEXT_DATA__" type="application/json">{}</script>'),
             markup().replace('"id": 106909', '"id": 999999, "id": 106909')]
    for html in cases:
        assert period.read_period(snapshot(html))["has_conflict"]
    monkeypatch.setattr(period, "MAX_DATA", 100)
    assert period.read_period(snapshot())["has_conflict"]
    assert period.load_data('[' * 100 + ']' * 100) is None


def test_source_scope_and_snapshot_validation():
    assert period.period_text(markup(), "https://example.com/recruit/106909") == ""
    assert period.job_id("https://jasoseol.com/recruit") is None
    text = snapshot()
    assert period.read_period(text + text) is None
    assert period.read_period(text.replace("마감일 (정규화): " + DUE, "마감일 (정규화): 2026-11-07T14:50:00+09:00"))["has_conflict"]


def test_review_title_edit_and_idempotent_approval_preserve_the_seoul_instant(monkeypatch):
    forbid_ai(monkeypatch)
    source, headers = source_ready(snapshot(), URL)
    response = client.post(f"/api/sources/{source}/ai-analyses", headers=headers, json={})
    assert response.status_code == 202
    path = f"/api/ai-analyses/{response.json()['id']}"
    analysis = client.get(path, headers=headers).json()
    assert analysis["status"] == "ready" and analysis["model"] == "html:url:v1"
    assert analysis["source_period"]["site"] == "jasoseol"
    assert analysis["candidates"][0]["due_at"] == DUE
    assert client.get("/api/deadlines", headers=headers).json() == []
    candidate = {key: analysis["candidates"][0][key] for key in ("id", "title", "due_at", "description", "selected")}
    candidate["title"] = "[테스트] 자소설닷컴 지원"
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
    assert inserted[0].isoformat() == DUE  # Verify before SQLite drops the offset.
    assert inserted[0].astimezone(timezone.utc).isoformat() == "2026-11-07T14:50:00+00:00"
