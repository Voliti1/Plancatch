"""JobPlanet HTML date-only review; synthetic documents and isolated SQLite."""
import json

import pytest
from sqlalchemy import event

from app.models.deadline import Deadline
from app.services import extraction, jobplanet_period as period
from app.services.url_deadlines import analyze_url, append_snapshot, review_data
from tests.test_html_analysis import forbid_ai, source_ready
from tests.test_sources import client, configure_test_jwt  # noqa: F401

URL = "https://www.jobplanet.co.kr/job/search?posting_ids%5B%5D=1776386&entry=jobposting_detail_test"
CANONICAL = "https://www.jobplanet.co.kr/job/search?posting_ids[]=1776386"
DATE = "2026.11.25"


def markup(raw=DATE, short="~11/25(수)", canonical=CANONICAL, label="마감일", wrapper="", extra=""):
    link = f'<link rel="canonical" href="{canonical}">' if canonical else ''
    # A normalized search cache end-of-day value must not supply an invisible time.
    cached = json.dumps({"jobs": [{"id": 1776386, "jd": {"end_at": "2026-11-25T23:59:59.000+09:00"}}]})
    return (f'<html><head>{link}</head><body><main><h1>[테스트] 경력직 채용</h1><div {wrapper}><dl><div>'
            + f'<dt><i class="jp-calendar"></i>{label}</dt><dd class="pl-[110px]"><span>{raw}</span>'
            + f'<span class="ml-[8px] text-orange-500">{short}</span></dd></div></dl></div>{extra}</main>'
            + f'<script type="application/json">{cached}</script></body></html>')


def snapshot(html=None, url=URL):
    doc = extraction.parse_page((html or markup()).encode(), "text/html", url)
    return append_snapshot(doc.text, url, url, doc.review)


def test_exact_date_field_and_weekday_are_read_without_inventing_a_clock():
    text = snapshot()
    info = period.read_period(text)
    assert info["site"] == "jobplanet" and info["date"] == "2026-11-25"
    assert info["end_text"] == "2026.11.25 ~11/25(수)" and not info["has_conflict"]
    assert info["deadline_at"] is None
    choices = review_data(text, URL)["choices"]
    assert len(choices) == 1 and choices[0]["date"] == "2026-11-25" and choices[0]["due_at"] is None
    result = analyze_url(text, URL, None)
    assert result.deadlines[0].due_at is None and result.warnings == [period.UNRESOLVED]
    assert "2026.11.25" in result.deadlines[0].evidence_text
    assert result.deadlines[0].evidence_text in text
    assert "23:59" not in text
    assert text.count(period.MARKER) == text.count(period.END_MARKER) == 1


def test_only_a_visibly_printed_clock_can_become_an_absolute_deadline():
    text = snapshot(markup(raw=DATE + " 14:30"))
    result = analyze_url(text, URL, None)
    assert result.deadlines[0].due_at.isoformat() == "2026-11-25T14:30:00+09:00"
    assert result.warnings == []


@pytest.mark.parametrize("changes", [{"short": "~11/26(수)"}, {"short": "~11/25(목)"},
                                    {"raw": "2026.02.30"}, {"canonical": None},
                                    {"canonical": CANONICAL.replace("1776386", "9999999")},
                                    {"extra": '<h1>다른 공고</h1>'},
                                    {"raw": DATE + " " * 350}])
def test_conflicts_or_unverified_scope_never_prefill_a_deadline(changes):
    text = snapshot(markup(**changes))
    assert period.read_period(text)["has_conflict"]
    result = analyze_url(text, URL, None)
    assert result.deadlines[0].due_at is None and result.warnings == [period.CONFLICT]


@pytest.mark.parametrize("url", ["https://example.com/job/search?posting_ids[]=1776386",
                                 "https://www.jobplanet.co.kr/job/search",
                                 CANONICAL + "&posting_ids[]=9999999",
                                 CANONICAL + "&posting_id=9999999",
                                 CANONICAL.replace("1776386", "1776386,9999999"),
                                 CANONICAL.replace("jobplanet.co.kr", "jobplanet.co.kr.evil.example"),
                                 CANONICAL.replace("https://", "https://name:password@"),
                                 CANONICAL.replace(".co.kr/", ".co.kr:8443/")])
def test_search_or_multiple_other_jobs_are_not_single_posting_urls(url):
    assert period.job_id(url) is None
    assert period.period_text(markup(), url) == ""


@pytest.mark.parametrize("wrapper", ["hidden", 'style="display:none"', 'aria-hidden="true"'])
def test_hidden_fields_are_not_evidence(wrapper):
    assert period.read_period(snapshot(markup(wrapper=wrapper))) is None


def test_unlabelled_date_and_different_field_are_not_deadlines():
    assert period.read_period(snapshot(markup(label="입사일"))) is None
    assert period.read_period(snapshot('<main><h1>채용</h1><dd><span>2026.11.25</span></dd></main>')) is None


def test_multiple_deadline_fields_and_unpaired_rows_require_review():
    other = '<dl><div><dt>마감일</dt><dd>2027.01.01</dd></div></dl>'
    assert period.read_period(snapshot(markup(extra=other)))["has_conflict"]
    html = markup().replace('</dt><dd class="pl-[110px]">', '</dt></div><div><dd class="pl-[110px]">')
    assert period.read_period(snapshot(html)) is None


def test_open_ended_remains_user_chosen_and_snapshots_are_validated():
    text = snapshot(markup(raw="채용 시 마감", short=""))
    assert review_data(text, URL)["open_ended"]
    assert analyze_url(text, URL, None).deadlines[0].due_at is None
    text = snapshot()
    assert period.read_period(text + text) is None
    assert period.read_period(text.replace("확인된 마감 날짜: 2026-11-25", "확인된 마감 날짜: 2027-11-25"))["has_conflict"]


def test_http_403_is_preserved_instead_of_parsing_or_faking_a_result(monkeypatch):
    monkeypatch.setattr(extraction, "public_target", lambda *_: None)
    monkeypatch.setattr(extraction, "check_robots", lambda *_: None)
    monkeypatch.setattr(extraction, "fetch_once", lambda *_: (403, {}, b""))
    def forbidden(*_):
        pytest.fail("Access denied responses must not be converted into a review")
    monkeypatch.setattr(extraction, "parse_page", forbidden)
    with pytest.raises(extraction.ExtractionError, match="^access_denied$"):
        extraction.extract("url", URL, None)


def test_date_only_api_requires_user_time_and_approval_remains_idempotent(monkeypatch):
    forbid_ai(monkeypatch)
    source, headers = source_ready(snapshot(), URL)
    started = client.post(f"/api/sources/{source}/ai-analyses", headers=headers, json={})
    assert started.status_code == 202
    path = f"/api/ai-analyses/{started.json()['id']}"
    analysis = client.get(path, headers=headers).json()
    assert analysis["status"] == "ready" and analysis["model"] == "html:url:v1"
    assert analysis["source_period"]["site"] == "jobplanet"
    assert analysis["date_choices"][0]["date"] == "2026-11-25"
    assert analysis["candidates"][0]["due_at"] is None and not analysis["candidates"][0]["selected"]
    assert client.post(path + "/approve", headers=headers, json={"revision": 1}).status_code == 422
    assert client.get("/api/deadlines", headers=headers).json() == []
    candidate = {key: analysis["candidates"][0][key] for key in ("id", "title", "due_at", "description", "selected")}
    candidate.update(due_at="2026-11-25T18:00:00+09:00", selected=True)
    saved = client.patch(path, headers=headers, json={"revision": 1, "candidates": [candidate]})
    assert saved.status_code == 200 and saved.json()["revision"] == 2
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
    assert inserted == [candidate["due_at"]]  # SQLite drops offsets after binding.
