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


def application_box(label='마감일', value='채용 시 마감', component='ApplyTimerBox'):
    return ['$', 'div', None, {'data-sentry-component': component, 'children': [
        ['$', 'span', None, {'children': label}],
        ['$', 'span', None, {'children': value}],
    ]}]


@pytest.mark.parametrize('wording', ['채용 시 마감', '채용 시까지', '채용 완료 시', '상시채용', '상시 모집'])
def test_bound_primary_open_ended_notice_overrides_placeholder_countdown_and_expiry(wording):
    html = markup() + '<script>self.__next_f.push(' + json.dumps([1,
        'c:' + json.dumps(application_box(value=wording), ensure_ascii=False) + '\n']) + ')</script>'
    text = snapshot(html)
    data = review_data(text, URL)
    assert data['open_ended'] and data['choices'] == []
    result = analyze_url(text, URL, None)
    assert result.deadlines[0].due_at is None
    assert any('채용 시 마감' in item for item in result.warnings)


@pytest.mark.parametrize('box', [application_box(component='RecommendedJobs'),
                                application_box(label='우대 조건')])
def test_unrelated_open_ended_strings_do_not_override_the_owned_job_period(box):
    html = markup() + '<script>self.__next_f.push(' + json.dumps([1,
        'c:' + json.dumps(box, ensure_ascii=False) + '\n']) + ')</script>'
    assert analyze_url(snapshot(html), URL, None).deadlines[0].due_at.isoformat() == DUE


def test_two_primary_application_boxes_are_conflicting_instead_of_prefilled():
    html = markup() + '<script>self.__next_f.push(' + json.dumps([1,
        'c:' + json.dumps([application_box(), application_box(value='다른 기간')], ensure_ascii=False) + '\n']) + ')</script>'
    assert analyze_url(snapshot(html), URL, None).deadlines[0].due_at is None


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


def test_primary_streaming_timer_can_precede_its_span_but_must_match_owned_expiry():
    html=markup().replace('data-sentry-component="Countdown"','data-pending="timer"')
    assert analyze_url(snapshot(html),URL,None).deadlines[0].due_at.isoformat()==DUE
    assert analyze_url(snapshot(html.replace('"2026-10-27T23:59"','"2026-10-28T23:59"')),URL,None).deadlines[0].due_at is None


def test_explicit_owned_head_closing_policy_overrides_a_placeholder_timer():
    canonical=URL.split('?')[0]
    html=f'<html><head><link rel="canonical" href="{canonical}"><meta name="description" content="경력 : 신입, 마감일 : 상시채용"></head><body>'+markup()+'</body></html>'
    data=review_data(snapshot(html),URL)
    assert data['open_ended']
    assert analyze_url(snapshot(html),URL,None).deadlines[0].due_at is None


@pytest.mark.parametrize('wrapper,open_ended', [('',True),('hidden',False)])
def test_primary_semantic_closing_field_wins_over_a_placeholder_date(wrapper,open_ended):
    canonical=URL.split('?')[0]
    field=f'<section id="application-section" {wrapper}><dl><div><dt>마감일</dt><dd>2026.10.27(화)<span>채용 시 마감</span></dd></div></dl></section>'
    html=f'<html><head><link rel="canonical" href="{canonical}"></head><body>'+markup()+field+'</body></html>'
    assert review_data(snapshot(html),URL)['open_ended'] is open_ended
    assert (analyze_url(snapshot(html),URL,None).deadlines[0].due_at is None) is open_ended


def test_primary_closing_policy_can_use_owned_job_metadata_when_canonical_is_absent():
    field='<section id="application-section"><dl><div><dt>마감일</dt><dd>2026.10.27(화)<span>채용 시 마감</span></dd></div></dl></section>'
    html=markup()+field
    assert review_data(snapshot(html),URL)['open_ended']
    assert analyze_url(snapshot(html),URL,None).deadlines[0].due_at is None
    # Neither a different job's metadata nor a conflicting canonical grants ownership.
    assert not review_data(snapshot(html.replace('50195748','99999999')),URL)['open_ended']
    conflicting='<head><link rel="canonical" href="https://www.jobkorea.co.kr/Recruit/GI_Read/99999999"></head>'+html
    assert not review_data(snapshot(conflicting),URL)['open_ended']


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
