"""Work24 public-job proof, closed utility dialogs, and 24:00 normalization."""
from datetime import UTC, datetime

import pytest
from sqlalchemy import event

from app.models.deadline import Deadline
from app.services import extraction
from app.services import work24_period as period
from app.services.url_deadlines import analyze_url, append_snapshot, review_data
from tests.test_html_analysis import forbid_ai, source_ready
from tests.test_sources import client, configure_test_jwt  # noqa: F401

ID = "K150122610270007"
URL = f"https://m.work24.go.kr{period.PATH}?wantedAuthNo={ID}&infoTypeCd=VALIDATION&infoTypeGroup=tb_workinfoworknet"
DUE = "2026-11-11T00:00:00+09:00"
RAW = "2026.11.10 (화) 24:00"


def dialog(attrs='', identity="chkPwdCfrmYn", classes="full_pop large full_01"):
    return (f'<section id="{identity}" class="{classes}" {attrs}>'
            '<h1>비밀번호 재확인</h1><p>PRIVATE_UTILITY_TEXT</p><input type="password"></section>')


def markup(raw=RAW, action=URL, hidden_id=ID, visible_id=ID, utility=None, extra="", wrapper=""):
    utility = dialog() if utility is None else utility
    return (f'<html><body><h2>[테스트] 공개 채용공고</h2>'
            f'<form id="moveForm" name="moveForm" method="post" action="{action}">'
            f'<input type="hidden" id="wantedAuthNo" name="wantedAuthNo" value="{hidden_id}"></form>'
            f'<main><p>공개 공고 본문</p><div class="emp_colbox_div" {wrapper}><div class="left_area br js_s"><div>'
            f'<strong class="block b1_sb mb08">접수 마감일</strong><p class="b1_sb cl-red mb08">{raw}</p>'
            '<span class="ddayDisplay">D-14</span></div></div></div>'
            f'<table><tr><th>구인인증번호<div>도움말</div></th><td>{visible_id}</td></tr></table>{extra}</main>'
            f'<footer id="footer"><form id="pwdCfrmForm000">{utility}</form></footer></body></html>')


def snapshot(html=None, url=URL):
    doc = extraction.parse_page((html or markup()).encode(), "text/html", url)
    return append_snapshot(doc.text, url, url, doc.review)


def test_verified_public_job_keeps_raw_24_and_normalizes_to_next_day_without_utility_text():
    html = markup(raw="2026.11.10 (화)&nbsp;24:00")
    parser = period.Work24Parser(URL)
    parser.feed(html)
    assert parser.verified and parser.closed_utilities == 1 and not parser.password_form
    text = snapshot(html)
    info = period.read_period(text)
    assert info["site"] == "work24" and info["end_text"] == RAW
    assert info["deadline_at"].isoformat() == DUE and not info["has_conflict"]
    assert "PRIVATE_UTILITY_TEXT" not in text
    assert info["remaining_text"] is None
    choices = review_data(text, URL)["choices"]
    assert choices[0]["date"] == "2026-11-11" and choices[0]["due_at"] == DUE
    result = analyze_url(text, URL, None)
    assert result.deadlines[0].due_at.isoformat() == DUE and result.warnings == []
    assert result.deadlines[0].evidence_text == "마감일 원문: " + RAW
    assert result.deadlines[0].evidence_text in text


@pytest.mark.parametrize("raw,expected", [
    ("2026.12.31 (목) 24:00", "2027-01-01T00:00:00+09:00"),
    ("2028.02.29 (화) 24:00", "2028-03-01T00:00:00+09:00"),
    ("2026.11.10 (화) 00:00", "2026-11-10T00:00:00+09:00"),
    ("2026.11.10 (화) 18:30", "2026-11-10T18:30:00+09:00"),
])
def test_day_year_leap_and_ordinary_clock_boundaries(raw, expected):
    due, conflict = period.parse_display(raw)
    assert due.isoformat() == expected and not conflict


@pytest.mark.parametrize("raw", ["2026.11.10 (화) 24:01", "2026.11.10 (화) 25:00",
                                 "2026.11.10 (화) 23:60", "2026.11.10 (수) 24:00",
                                 "2026.02.29 24:00", "9999.12.31 24:00"])
def test_invalid_clocks_weekdays_or_overflow_require_confirmation(raw):
    text = snapshot(markup(raw=raw))
    assert period.read_period(text)["has_conflict"]
    result = analyze_url(text, URL, None)
    assert result.deadlines[0].due_at is None and result.warnings == [period.CONFLICT]


def test_missing_clock_and_open_ended_do_not_get_midnight_or_a_timer_derived_date():
    text = snapshot(markup(raw="2026.11.10 (화)"))
    assert period.read_period(text)["deadline_at"] is None
    assert analyze_url(text, URL, None).warnings == [period.UNRESOLVED]
    assert review_data(text, URL)["choices"][0]["date"] == "2026-11-10"
    text = snapshot(markup(raw="채용 시까지"))
    assert review_data(text, URL)["open_ended"]
    assert analyze_url(text, URL, None).deadlines[0].due_at is None


@pytest.mark.parametrize("attrs,classes,identity", [
    ('style="display:block"', "full_pop large full_01", "chkPwdCfrmYn"),
    ('aria-hidden="false"', "full_pop large full_01", "chkPwdCfrmYn"),
    ('data-state="open"', "full_pop large full_01", "chkPwdCfrmYn"),
    ('open', "full_pop large full_01", "chkPwdCfrmYn"),
    ('', "full_pop large full_01 active", "chkPwdCfrmYn"),
    ('', "full_pop large full_01", "unknownLogin"),
])
def test_active_or_unknown_password_dialogs_still_require_login(attrs, classes, identity):
    with pytest.raises(extraction.ExtractionError, match="^requires_login$"):
        snapshot(markup(utility=dialog(attrs, identity, classes)))


def test_passwords_outside_the_verified_footer_exception_still_require_login():
    outside = '<section class="full_pop large full_01" id="chkPwdCfrmYn"><input type="password"></section>'
    for html in [markup(extra='<form><input type="password"></form>'), markup(extra=outside),
                 markup().replace('id="footer"', 'id="otherFooter"'),
                 markup().replace('id="pwdCfrmForm000"', 'id="otherForm"')]:
        with pytest.raises(extraction.ExtractionError, match="^requires_login$"):
            snapshot(html)


@pytest.mark.parametrize("changes", [{"action": URL.replace(ID, "K150122610270008")},
                                    {"hidden_id": "K150122610270008"}, {"visible_id": "K150122610270008"}])
def test_mismatched_job_proof_never_suppresses_a_password_gate(changes):
    with pytest.raises(extraction.ExtractionError, match="^requires_login$"):
        snapshot(markup(**changes))
    text = snapshot(markup(**changes, utility=""))
    assert period.read_period(text)["has_conflict"]
    assert analyze_url(text, URL, None).deadlines[0].due_at is None


def test_other_hosts_types_duplicate_ids_and_hidden_dates_do_not_get_the_exception():
    for url in [URL.replace("m.work24.go.kr", "example.com"), URL + "&wantedAuthNo=" + ID,
                URL.replace("VALIDATION", "OTHER"), URL.replace("wantedAuthNo=", "otherId=")]:
        assert period.job_id(url) is None
        with pytest.raises(extraction.ExtractionError, match="^requires_login$"):
            snapshot(markup(), url)
    with pytest.raises(extraction.ExtractionError, match="^requires_login$"):
        snapshot(markup(wrapper="hidden"))


def test_duplicate_fields_capture_limits_and_snapshot_mutation():
    duplicate = '<div class="emp_colbox_div"><div><strong>접수 마감일</strong><p>2026.11.10 (화) 24:00</p></div></div>'
    text = snapshot(markup(utility="", extra=duplicate))
    assert period.read_period(text)["has_conflict"]
    text = snapshot(markup(raw=RAW + " " * 210, utility=""))
    assert period.read_period(text)["has_conflict"]
    text = snapshot()
    assert period.read_period(text + text) is None
    assert period.read_period(text.replace("공고 인증번호: " + ID, "공고 인증번호: K150122610270008")) is None
    assert period.read_period(text.replace("마감일 (정규화): " + DUE, "마감일 (정규화): 2026-11-10T00:00:00+09:00"))["has_conflict"]


def test_api_approval_keeps_next_day_instant_and_idempotency(monkeypatch):
    forbid_ai(monkeypatch)
    source, headers = source_ready(snapshot(), URL)
    started = client.post(f"/api/sources/{source}/ai-analyses", headers=headers, json={})
    assert started.status_code == 202
    path = f"/api/ai-analyses/{started.json()['id']}"
    analysis = client.get(path, headers=headers).json()
    assert analysis["status"] == "ready" and analysis["model"] == "html:url:v1"
    assert analysis["source_period"]["site"] == "work24"
    assert analysis["candidates"][0]["due_at"] == DUE
    assert client.get("/api/deadlines", headers=headers).json() == []
    inserted = []
    def capture(_mapper, _connection, item):
        inserted.append(item.due_at)
    event.listen(Deadline, "before_insert", capture)
    try:
        first = client.post(path + "/approve", headers=headers, json={"revision": 1})
        again = client.post(path + "/approve", headers=headers, json={"revision": 1})
    finally:
        event.remove(Deadline, "before_insert", capture)
    assert first.status_code == again.status_code == 200
    assert first.json()["approved_deadline_ids"] == again.json()["approved_deadline_ids"]
    assert inserted == [datetime.fromisoformat(DUE)]
    assert inserted[0].astimezone(UTC).isoformat() == "2026-11-10T15:00:00+00:00"
    assert client.get(path, headers=headers).json()["status"] == "approved"
    assert len(client.get("/api/deadlines", headers=headers).json()) == 1
