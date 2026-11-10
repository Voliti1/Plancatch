"""Public popup URLs use the same bounded deadline/company path; no live network."""

import pytest

from app.services import extraction, saramin_period
from app.services.html_analysis import matching_period
from app.services.url_deadlines import analyze_url, append_snapshot, review_data
from tests.test_saramin_period import markup

POPUP = "https://www.saramin.co.kr/zf_user/jobs/relay/pop-view?rec_idx=55504409&t_ref=main&t_ref_content=platinum_plus_fix_expand"
CANONICAL = "https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=55504409"


def html(canonical=None):
    head = f'<link rel="canonical" href="{canonical}">' if canonical else ""
    return (
        f"<html><head><title>한화세미텍 채용</title>{head}</head><body>"
        + markup(start="2026.11.09 00:00", end="2026.11.22 23:59", timer="")
        + '<div class="jv_company company_info_wrap_55504409">'
        '<a class="company_name" href="/zf_user/company-info/view?csn=company">한화세미텍(주)</a></div>'
        "<aside>추천 기업 마감일 2030.01.01 09:00</aside></body></html>"
    ).encode()


def mock_fetch(monkeypatch, popup_body=None):
    fetched, checked = [], []
    monkeypatch.setattr(
        extraction, "public_target", lambda url: ("www.saramin.co.kr", 443, "8.8.8.8")
    )
    monkeypatch.setattr(
        extraction, "check_robots", lambda url, deadline: checked.append(url)
    )

    def fetch(url, deadline):
        fetched.append(url)
        assert url in {POPUP, CANONICAL}
        return (
            200,
            {"content-type": "text/html; charset=utf-8"},
            popup_body if url == POPUP and popup_body is not None else html(),
        )

    monkeypatch.setattr(extraction, "fetch_once", fetch)
    return fetched, checked


@pytest.mark.parametrize("follow", [False, True])
def test_popup_reads_exact_period_company_and_keeps_original_url_binding(
    monkeypatch, follow
):
    fetched, checked = mock_fetch(monkeypatch, html(CANONICAL if follow else None))
    document = extraction.extract("url", POPUP, None)
    info = review_data(document.text, POPUP)
    assert info["company_name"] == "한화세미텍(주)"
    assert info["scope_confirmed"] and not info["has_conflict"]
    assert len(info["choices"]) == 1
    assert info["choices"][0]["due_at"] == "2026-11-22T23:59:00+09:00"
    assert (
        matching_period(document.text, POPUP)["deadline_at"].isoformat()
        == "2026-11-22T23:59:00+09:00"
    )
    result = analyze_url(document.text, POPUP, "입력한 일정 제목")
    assert result.deadlines[0].title == "입력한 일정 제목"
    assert result.deadlines[0].due_at.isoformat() == "2026-11-22T23:59:00+09:00"
    assert result.warnings == []
    assert fetched == checked == ([POPUP, CANONICAL] if follow else [POPUP])
    assert not any("2030" in choice["evidence_text"] for choice in info["choices"])


@pytest.mark.parametrize(
    "url",
    [
        POPUP.replace("www.saramin.co.kr", "www.saramin.co.kr.evil.example"),
        POPUP + "&rec_idx=12345",
        POPUP.replace("55504409", "invalid"),
        POPUP.replace("https://", "https://user:secret@"),
        POPUP.replace(".co.kr/", ".co.kr:8443/"),
        POPUP.replace("/relay/pop-view", "/relay/pop-view-unrelated"),
    ],
)
def test_popup_expansion_does_not_accept_ambiguous_or_foreign_urls(url):
    assert not saramin_period.is_job_url(url)
    assert extraction.public_job_canonical(url, html(CANONICAL), "text/html") is None
    doc = extraction.parse_page(html(), "text/html", url)
    assert not doc.review["scope_confirmed"] and doc.review["company_name"] is None


@pytest.mark.parametrize(
    "target",
    [
        CANONICAL.replace("55504409", "12345"),
        CANONICAL + "&extra=1",
        CANONICAL.replace("www.saramin.co.kr", "example.com"),
        CANONICAL.replace("https://", "http://"),
    ],
)
def test_popup_canonical_still_must_be_same_origin_and_exact_job(target):
    assert extraction.public_job_canonical(POPUP, html(target), "text/html") is None


def test_popup_login_gate_and_canonical_robots_failure_remain_blocked(monkeypatch):
    fetched, _ = mock_fetch(
        monkeypatch,
        html(CANONICAL).replace(b"</body>", b'<input type="password"></body>'),
    )
    with pytest.raises(extraction.ExtractionError, match="requires_login"):
        extraction.extract("url", POPUP, None)
    assert fetched == [POPUP]
    fetched, _ = mock_fetch(monkeypatch, html(CANONICAL))

    def robots(url, deadline):
        if url == CANONICAL:
            raise extraction.ExtractionError("robots_disallowed")

    monkeypatch.setattr(extraction, "check_robots", robots)
    with pytest.raises(extraction.ExtractionError, match="robots_disallowed"):
        extraction.extract("url", POPUP, None)
    assert fetched == [POPUP]


def test_previously_saved_valid_popup_period_can_be_reviewed_without_refetch():
    # Old canonical-fetched snapshots remain bound to the submitted popup ID.
    doc = extraction.parse_page(html(), "text/html", CANONICAL)
    text = append_snapshot(doc.text, POPUP, CANONICAL, doc.review)
    assert analyze_url(text, POPUP, None).deadlines[0].due_at is not None
    assert matching_period(text, POPUP.replace("55504409", "12345")) is None
