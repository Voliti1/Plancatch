"""Synthetic JobKorea HTML and isolated SQLite; no live fetch, AI or user DB."""
import json
from datetime import datetime

import pytest
from sqlalchemy import event

from app.models.deadline import Deadline
from app.services import extraction
from app.services import jobkorea_period as period
from app.services.url_deadlines import analyze_url, append_snapshot, review_data
from tests.test_html_analysis import forbid_ai, source_ready
from tests.test_sources import client, configure_test_jwt  # noqa: F401

URL = "https://www.jobkorea.co.kr/Recruit/GI_Read/50195748?sc=511&traceId=test"
DUE = "2026-10-27T23:59:59+09:00"


def node(end=DUE):
    return ["$", "div", None, {"children": [
        ["$", "span", None, {"children": "남은기간"}],
        ["$", "$L3d", None, {"endDate": end, "textStyle": {"weight": "bold"}}],
    ]}]


def markup(end=DUE, metadata="2026-10-27T23:59", count=1, identity="50195748", split=False):
    posting = {"@type": "JobPosting", "url": f"https://www.jobkorea.co.kr/Recruit/GI_Read/{identity}",
               "identifier": {"value": identity}, "title": "테스트 기업 채용", "validThrough": metadata}
    body = "<main>테스트 기업 채용</main>" + '<div><span>남은기간</span><span data-sentry-component="Countdown"></span></div>' * count
    stream = "a:" + json.dumps([node(end)] * count, ensure_ascii=False) + "\n"
    # Other jobs' expiry fields must not be used as the current countdown.
    stream += 'b:{"applyCloseDate":"2029-12-31 23:59:59","endDate":"2030-01-01T23:59:59+09:00"}\n'
    parts = [stream[:len(stream)//2], stream[len(stream)//2:]] if split else [stream]
    return (body + '<script type="application/ld+json">' + json.dumps(posting) + '</script>'
            + ''.join('<script>self.__next_f.push(' + json.dumps([1, value], ensure_ascii=False) + ')</script>' for value in parts))


def snapshot(html=None, url=URL):
    doc = extraction.parse_page((html or markup()).encode(), "text/html", url)
    return append_snapshot(doc.text, url, url, doc.review)


def test_exact_countdown_deadline_including_seconds_without_relative_clock_arithmetic():
    text = snapshot(markup(split=True))
    info = period.read_period(text)
    assert info["site"] == "jobkorea"
    assert info["deadline_at"].isoformat() == DUE
    assert info["remaining_text"] is None
    choices = review_data(text, URL)["choices"]
    assert len(choices) == 1 and choices[0]["due_at"] == DUE
    result = analyze_url(text, URL, "입력한 제목")
    assert result.deadlines[0].due_at.isoformat() == DUE
    assert result.deadlines[0].evidence_text in text
    assert result.warnings == []


def test_relative_countdown_alone_never_becomes_a_deadline():
    html = '<main><div>남은기간<span data-sentry-component="Countdown">0일 14:40:59</span></div></main>'
    assert period.MARKER not in snapshot(html)
    assert analyze_url(snapshot(html), URL, None).deadlines[0].due_at is None


@pytest.mark.parametrize("metadata", ["2026-10-28T23:59", "2026-10-27T23:59:00", "2026-10-27T14:59Z"])
def test_metadata_conflict_requires_manual_confirmation(metadata):
    # The UTC minute case agrees; an explicitly different date/second does not.
    text = snapshot(markup(metadata=metadata))
    conflict = metadata != "2026-10-27T14:59Z"
    assert period.read_period(text)["has_conflict"] is conflict
    result = analyze_url(text, URL, None)
    assert (result.deadlines[0].due_at is None) is conflict
    if conflict:
        assert result.warnings == [period.CONFLICT]


def test_two_countdowns_are_not_collapsed_into_one_authoritative_date():
    text = snapshot(markup(count=2))
    assert period.read_period(text)["has_conflict"]
    assert analyze_url(text, URL, None).deadlines[0].due_at is None


@pytest.mark.parametrize("raw", ["2026-10-27T23:59:59", "2026-02-30T23:59:59+09:00", "2026-10-27T23:59:99+09:00", "0일 14:40:59"])
def test_invalid_or_unzoned_timer_does_not_override_existing_metadata(raw):
    text = snapshot(markup(end=raw))
    assert period.read_period(text) is None
    assert review_data(text, URL)["choices"][0]["due_at"] == "2026-10-27T23:59:00+09:00"


def test_other_job_or_site_cannot_supply_the_jobkorea_countdown():
    assert period.read_period(snapshot(markup(identity="99999999"))) is None
    other = "https://example.com/Recruit/GI_Read/50195748"
    assert period.period_text(markup(), other, "") == ""
    assert period.read_period(snapshot(markup(), url=other)) is None


def test_scripts_are_data_only_and_limits_fail_closed(monkeypatch):
    html = markup().replace('self.__next_f.push(', 'executeCode();self.__next_f.push(')
    assert period.read_period(snapshot(html)) is None
    monkeypatch.setattr(period, "MAX_NODES", 1)
    assert period.read_period(snapshot()) is None


def test_snapshot_mutation_or_duplicate_markers_cannot_recover_a_guessed_deadline():
    text = snapshot()
    assert period.read_period(text + text) is None
    changed = text.replace("공고 메타데이터 마감일: 2026-10-27T23:59", "공고 메타데이터 마감일: 2026-11-01T23:59")
    assert period.read_period(changed)["has_conflict"]
    assert period.read_period(changed)["deadline_at"] is None


def test_ready_review_approval_and_duplicate_approval_keep_exact_jobkorea_deadline(monkeypatch):
    forbid_ai(monkeypatch)
    source, headers = source_ready(snapshot(), URL)
    created = client.post(f"/api/sources/{source}/ai-analyses", headers=headers, json={})
    assert created.status_code == 202
    path = f"/api/ai-analyses/{created.json()['id']}"
    review = client.get(path, headers=headers).json()
    assert review["model"] == "html:url:v1" and review["status"] == "ready"
    assert review["source_period"]["site"] == "jobkorea"
    assert review["source_period"]["deadline_at"] == DUE
    assert review["candidates"][0]["due_at"] == DUE
    assert client.get("/api/deadlines", headers=headers).json() == []
    inserted = []

    def capture_insert(_mapper, _connection, deadline):
        inserted.append(deadline.due_at)

    # SQLite discards timestamp offsets; verify the offset-aware value supplied
    # to persistence directly. Production PostgreSQL uses timestamptz.
    event.listen(Deadline, "before_insert", capture_insert)
    try:
        first = client.post(path + "/approve", headers=headers, json={"revision": 1})
        second = client.post(path + "/approve", headers=headers, json={"revision": 1})
    finally:
        event.remove(Deadline, "before_insert", capture_insert)
    assert first.status_code == second.status_code == 200
    assert first.json()["approved_deadline_ids"] == second.json()["approved_deadline_ids"]
    rows = client.get("/api/deadlines", headers=headers).json()
    assert len(rows) == 1
    assert rows[0]["id"] == first.json()["approved_deadline_ids"][0]
    assert inserted == [datetime.fromisoformat(DUE)]
    assert inserted[0].utcoffset() == datetime.fromisoformat(DUE).utcoffset()
