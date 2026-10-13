"""Synthetic public HTML/AI responses; no external fetch, Gemini or user DB rows."""
import json
import uuid
from datetime import datetime, timezone

import pytest

from app.schemas.analysis import AnalysisResponse
from app.services import ai_analysis, extraction
from app.services import saramin_period as period

URL = "https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=55170548"
END = "2026.11.01 23:59"
TIMER = ('<div class="info_timer" data-remain-time="1677187"><span class="txt">남은 기간</span>'
         '<span class="day">19</span><span class="txt_day">일</span><span class="time">09:49:52</span></div>')


def markup(end=END, start="2026.10.01 00:00", timer=TIMER):
    return (f'<div class="jv_cont jv_howto"><h2>접수기간 및 방법</h2><div class="cont box">{timer}'
            f'<dl class="info_period"><dt>시작일</dt><dd>{start}</dd>'
            f'<dt class="end">마감일</dt><dd>{end}</dd></dl>'
            '<button onclick="fetch(\'http://127.0.0.1\')">입사지원</button>'
            '<p>마감일은 기업의 사정, 조기마감 등으로 변경될 수 있습니다.</p></div></div>')


def document(html=None, url=URL):
    return extraction.parse_page((html or markup()).encode(), "text/html; charset=utf-8", url)


def result(monkeypatch, text, evidence=END, due=None):
    proposal = {"title": "회사 채용 마감", "due_at": due, "description": None,
                "evidence_text": evidence, "confidence": 0.8}
    envelope = {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": json.dumps({
        "deadlines": [proposal], "warnings": [],
    })}]}}]}
    monkeypatch.setattr(ai_analysis, "provider_request", lambda *args: envelope)
    return ai_analysis.analyze_text(text, "test-model")


def test_visible_period_and_timer_are_distinct_evidence_not_relative_date_arithmetic():
    text = document().text
    snapshot = period.read_period(text)
    assert snapshot["start_text"] == "2026.10.01 00:00"
    assert snapshot["end_text"] == END
    assert snapshot["deadline_at"].isoformat() == "2026-11-01T23:59:00+09:00"
    assert snapshot["remaining_text"] == "19일 09:49:52"
    assert "data-remain-time 원문): 1677187" in text
    assert "fetch(" not in text
    assert snapshot["has_conflict"] is False


@pytest.mark.parametrize("url", [
    "https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=55170548&view_type=list#seq=0",
    URL.replace("www.", ""),
])
def test_official_job_url_forms(url):
    assert period.read_period(document(url=url).text)["end_text"] == END


@pytest.mark.parametrize("url", [None, "https://example.com/view?rec_idx=55170548",
    URL.replace("www.saramin.co.kr", "www.saramin.co.kr.evil.example"),
    URL.replace("/jobs/view", "/auth"), URL + "&rec_idx=99999",
    URL.replace("55170548", "nonnumeric"), URL.replace("https://", "https://user:pass@"),
    URL.replace(".co.kr/", ".co.kr:8443/"),
])
def test_adapter_does_not_match_other_domains_paths_ambiguous_ids_or_credentials(url):
    assert period.MARKER not in document(url=url).text


@pytest.mark.parametrize("container", ['<div hidden>{}</div>', '<nav>{}</nav>',
    '<template>{}</template>', '<div aria-hidden="true">{}</div>', '<div style="display:none">{}</div>'])
def test_hidden_periods_ads_and_navigation_are_not_extracted(container):
    text = document('<main>현재 공고</main>' + container.format(markup())).text
    assert period.MARKER not in text and END not in text


def test_period_outside_main_is_recovered_without_including_other_sections():
    html = '<main>현재 공고</main>' + markup() + '<dl class="info_period"><dt>마감일</dt><dd>2030.01.01 09:00</dd></dl>'
    text = document(html).text
    assert "2030" not in text
    assert period.read_period(text)["end_text"] == END


def test_timer_alone_does_not_establish_deadline():
    text = document('<main>채용 안내</main><div class="jv_cont jv_howto">' + TIMER + '</div>').text
    assert period.read_period(text) is None


def test_initial_zero_html_timer_does_not_expire_or_replace_the_printed_deadline(monkeypatch):
    timer = TIMER.replace(">19<", ">0<").replace("09:49:52", "00:00:00")
    text = document(markup(timer=timer)).text
    snapshot = period.read_period(text)
    assert snapshot["remaining_text"] == "0일 00:00:00"
    output = result(monkeypatch, text)
    assert output.deadlines[0].due_at == snapshot["deadline_at"] and output.warnings == []


@pytest.mark.parametrize("end", ["2026.11.01", "11.01 23:59", "채용시까지", "2026.02.30 23:59", "2026.11.01 25:59"])
def test_incomplete_invalid_and_open_ended_dates_never_get_synthetic_year_time(monkeypatch, end):
    text = document(markup(end=end)).text
    snapshot = period.read_period(text)
    assert snapshot["deadline_at"] is None
    output = result(monkeypatch, text, end, "2026-11-01T23:59:00+09:00")
    assert output.deadlines[0].due_at is None
    assert period.UNRESOLVED in output.warnings


@pytest.mark.parametrize("html", [
    markup() + markup(end="2026.11.02 23:59"),
    markup(start="2026.11.02 00:00"),
    markup() * 9,
])
def test_conflicts_and_capture_limits_block_automatic_dates(monkeypatch, html):
    text = document(html).text
    assert period.read_period(text)["has_conflict"] is True
    output = result(monkeypatch, text, END, "2026-11-01T23:59:00+09:00")
    assert output.deadlines[0].due_at is None and period.CONFLICT in output.warnings


def test_repeated_identical_periods_do_not_make_up_one_timer():
    snapshot = period.read_period(document(markup() * 2).text)
    assert snapshot["deadline_at"] is not None and not snapshot["has_conflict"]
    assert snapshot["remaining_text"] is None


@pytest.mark.parametrize("timer", [TIMER.replace(">19<", ">bad<"), TIMER.replace("09:49:52", "24:00:00"),
    TIMER.replace('data-remain-time="1677187"', 'data-remain-time="-7"')])
def test_bad_timer_cannot_replace_or_invalidate_a_printed_deadline(timer):
    snapshot = period.read_period(document(markup(timer=timer)).text)
    assert snapshot["deadline_at"].isoformat() == "2026-11-01T23:59:00+09:00"
    assert not snapshot["has_conflict"]


def test_real_password_gate_is_not_bypassed():
    with pytest.raises(extraction.ExtractionError, match="requires_login"):
        document(markup() + '<input type="password">')


@pytest.mark.parametrize("due", [None, "2026-11-01T23:59:00Z", "2026-11-01T14:59:00Z"])
def test_dotted_closing_date_is_evidence_validated_in_kst(monkeypatch, due):
    output = result(monkeypatch, document().text, END, due)
    assert output.deadlines[0].due_at.isoformat() == "2026-11-01T23:59:00+09:00"
    assert output.warnings == []


def test_opening_date_and_wrong_closing_date_cannot_become_application_deadline(monkeypatch):
    text = document().text
    for evidence, due in [("2026.10.01 00:00", "2026-10-01T00:00:00+09:00"),
                          (END, "2026-11-02T23:59:00+09:00")]:
        output = result(monkeypatch, text, evidence, due)
        assert output.deadlines[0].due_at is None
        assert ai_analysis.DATE_CONFLICT_NOTICE in output.warnings


def test_period_response_is_optional_snapshot_derived_and_requires_no_database_migration():
    fields = {"id": uuid.uuid4(), "source_id": uuid.uuid4(), "input_text": document().text, "model": "test-model",
              "status": "ready", "revision": 1, "candidates": [], "warnings": [], "approved_deadline_ids": [],
              "error_message": None, "created_at": datetime.now(timezone.utc), "updated_at": datetime.now(timezone.utc)}
    response = AnalysisResponse(**fields).model_dump(mode="json")
    assert response["source_period"]["remaining_text"] == "19일 09:49:52"
    assert response["source_period"]["deadline_at"] == "2026-11-01T23:59:00+09:00"
    assert AnalysisResponse(**(fields | {"input_text": "과거 분석 원문"})).model_dump()["source_period"] is None
