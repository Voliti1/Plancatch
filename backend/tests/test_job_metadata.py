"""Bounded same-page HTML JobPosting evidence, never JS execution or crawling."""
import json

import pytest

from app.services import extraction as service

JOB_URL = "https://www.jobkorea.co.kr/Recruit/GI_Read/50076426"
JOB = {"@context": "https://schema.org", "@type": "JobPosting", "title": "제조팀 모집",
       "url": JOB_URL, "identifier": {"@type": "PropertyValue", "name": "JobKorea", "value": "50076426"},
       "validThrough": "2026-10-31T23:59", "description": "<p>지원 서류 제출</p>"}


def job_markup(data=JOB, body="<main>공개 공고</main>"):
    return ('<html><head><title>공고 페이지</title><script type="application/ld+json">'
            + json.dumps(data).replace("<", "\\u003c") + '</script></head><body>' + body
            + '</body></html>').encode()


@pytest.mark.parametrize("data", [JOB, [JOB], {"@graph": [JOB]},
                                   {"@graph": [{"@type": "WebSite"}, JOB]}])
def test_inert_metadata_restores_same_job_deadline_and_provenance(data):
    document = service.parse_page(job_markup(data), "text/html; charset=utf-8", JOB_URL)
    assert document.title == "공고 페이지"
    assert document.text.startswith("공개 공고\n\n")
    assert "JSON-LD JobPosting" in document.text
    assert "마감일 (validThrough): 2026-10-31T23:59" in document.text
    assert "제조팀 모집" in document.text
    assert "지원 서류 제출" in document.text
    assert service.DEFAULT_TIMEZONE_POLICY in document.text
    assert service.STRUCTURED_DATE_NOTICES[1] not in document.text
    assert "마감일 (validThrough): 2026-10-31T23:59+09:00" not in document.text


@pytest.mark.parametrize("kind", ["JobPosting", ["Thing", "JobPosting"],
                                  "https://schema.org/JobPosting", "http://schema.org/JobPosting"])
def test_schema_type_forms_are_supported(kind):
    assert "validThrough" in service.parse_page(job_markup({**JOB, "@type": kind}), "text/html", JOB_URL).text


@pytest.mark.parametrize("expires,notice", [
    ("2026-10-31", service.STRUCTURED_DATE_NOTICES[0]),
    ("2026-10-31T23:59", service.DEFAULT_TIMEZONE_POLICY),
    ("2026-10-31T23:59:00+09:00", None), ("2026-10-31T14:59:00Z", None),
])
def test_raw_date_and_offset_are_preserved_never_filled_in(expires, notice):
    text = service.parse_page(job_markup({**JOB, "validThrough": expires}), "text/html", JOB_URL).text
    assert f"마감일 (validThrough): {expires}" in text
    assert (notice in text) if notice else not any(item in text for item in service.STRUCTURED_DATE_NOTICES)


@pytest.mark.parametrize("changes", [
    {"url": "https://www.jobkorea.co.kr/Recruit/GI_Read/99999"},
    {"url": "https://other.example/Recruit/GI_Read/50076426"},
    {"url": "http://www.jobkorea.co.kr/Recruit/GI_Read/50076426"},
    {"url": "https://user:password@www.jobkorea.co.kr/Recruit/GI_Read/50076426"},
    {"url": "https://www.jobkorea.co.kr:8443/Recruit/GI_Read/50076426"},
    {"url": "https://www.jobkorea.co.kr:invalid/Recruit/GI_Read/50076426"},
    {"url": "http://127.0.0.1/admin"}, {"url": ""}, {"url": None}, {"url": {"@id": JOB_URL}},
    {"identifier": {"value": "99999"}}, {"identifier": None},
    {"@type": "Advertisement"}, {"@type": {}},
    {"@id": "https://www.jobkorea.co.kr/Recruit/GI_Read/99999"},
])
def test_other_jobs_ads_and_conflicting_identities_cannot_supply_deadlines(changes):
    assert service.parse_page(job_markup({**JOB, **changes}), "text/html", JOB_URL).text == "공개 공고"


def test_ad_record_is_excluded_even_with_same_title_and_different_date():
    advertisement = {**JOB, "url": "https://www.jobkorea.co.kr/Recruit/GI_Read/99999",
                     "validThrough": "2026-10-14T09:00:00+09:00"}
    text = service.parse_page(job_markup([advertisement, JOB]), "text/html", JOB_URL).text
    assert "2026-10-31T23:59" in text
    assert "2026-10-14" not in text


def test_metadata_requires_url_evidence_not_just_matching_title():
    record = {key: value for key, value in JOB.items() if key not in {"url", "identifier"}}
    assert service.parse_page(job_markup(record), "text/html", JOB_URL).text == "공개 공고"
    for key in ("@id", "mainEntityOfPage"):
        value = {"@id": JOB_URL} if key == "mainEntityOfPage" else JOB_URL
        assert "validThrough" in service.parse_page(job_markup({**record, key: value}), "text/html", JOB_URL).text
    assert service.parse_page(job_markup(), "text/html").text == "공개 공고"


def test_jobkorea_tracking_query_is_not_a_different_job():
    submitted = JOB_URL + "?Oem_Code=C1&logpath=1&stext=반도체#seq=0"
    assert "validThrough" in service.parse_page(job_markup(), "text/html", submitted).text


def test_generic_query_identity_is_never_discarded():
    requested = "https://jobs.example/view?job=123&mode=detail"
    for metadata_url in ("https://jobs.example/view?job=999&mode=detail", "https://jobs.example/view"):
        data = {**JOB, "url": metadata_url}
        assert service.parse_page(job_markup(data), "text/html", requested).text == "공개 공고"
    matched = {**JOB, "url": "https://jobs.example/view?mode=detail&job=123"}
    assert "validThrough" in service.parse_page(job_markup(matched), "text/html", requested).text


@pytest.mark.parametrize("expires", [None, {}, 20261031, "", "채용시까지", "10/31", "2026-02-30",
                                      "2026-10-31T25:59", "2026-10-31T23:59+25:00",
                                      "2026-10-31T23:59+09:60", "2026-10-31T23:59:60"])
def test_invalid_or_incomplete_dates_do_not_become_synthetic_deadlines(expires):
    assert service.parse_page(job_markup({**JOB, "validThrough": expires}), "text/html", JOB_URL).text == "공개 공고"


def test_identical_duplicates_are_safe_but_conflicting_dates_are_not_merged():
    assert "validThrough" in service.parse_page(job_markup([JOB, JOB]), "text/html", JOB_URL).text
    conflicting = {**JOB, "validThrough": "2026-11-01T23:59"}
    assert service.parse_page(job_markup([JOB, conflicting]), "text/html", JOB_URL).text == "공개 공고"


@pytest.mark.parametrize("container", ['<div hidden>{}</div>', '<nav>{}</nav>', '<template>{}</template>'])
def test_hidden_or_navigation_metadata_is_ignored(container):
    script = '<script type="application/ld+json">' + json.dumps(JOB) + '</script>'
    html = ('<main>공개 공고</main>' + container.format(script)).encode()
    assert service.parse_page(html, "text/html", JOB_URL).text == "공개 공고"


def test_metadata_cannot_bypass_real_login_gate():
    with pytest.raises(service.ExtractionError, match="requires_login"):
        service.parse_page(job_markup(body='<input type="password">'), "text/html", JOB_URL)


@pytest.mark.parametrize("attribute", ["hidden", 'aria-hidden="true"', 'style="display:none"'])
def test_explicitly_hidden_script_metadata_is_ignored(attribute):
    html = job_markup().replace(b'type="application/ld+json"', f'type="application/ld+json" {attribute}'.encode())
    assert service.parse_page(html, "text/html", JOB_URL).text == "공개 공고"


def test_escaped_surrogate_does_not_break_visible_extraction():
    assert service.parse_page(job_markup({**JOB, "title": "bad\ud800"}), "text/html", JOB_URL).text == "공개 공고"


def test_block_limit_and_deep_invalid_json_do_not_leak_partial_metadata():
    scripts = '<script type="application/ld+json">{}</script>' * service.MAX_JSON_LD_BLOCKS
    html = scripts.encode() + job_markup()
    assert service.parse_page(html, "text/html", JOB_URL).text == "공개 공고"
    block = '[' * 1100 + '0' + ']' * 1100
    html = ('<main>공개 공고</main><script type="application/ld+json">' + block + '</script>').encode()
    assert service.parse_page(html, "text/html", JOB_URL).text == "공개 공고"


@pytest.mark.parametrize("script", [
    '<script type="application/ld+json">{bad-json}</script>',
    '<script>fetch("http://127.0.0.1");</script>',
    '<script type="application/ld+json" src="http://127.0.0.1/secret">{}</script>',
])
def test_bad_metadata_or_arbitrary_javascript_is_not_text_or_executed(script):
    assert service.parse_page(('<main>공개 공고</main>' + script).encode(), "text/html", JOB_URL).text == "공개 공고"


def test_metadata_only_job_page_is_readable_but_other_script_only_pages_are_not():
    assert "validThrough" in service.parse_page(job_markup(body=""), "text/html", JOB_URL).text
    with pytest.raises(service.ExtractionError, match="empty_content_or_rendering_required"):
        service.parse_page(job_markup({**JOB, "@type": "Thing"}, body=""), "text/html", JOB_URL)


def test_description_is_visible_plain_text_not_scripts_or_hidden_popups():
    data = {**JOB, "description": '<main>제출 서류</main><script>secret()</script>'
            '<div hidden>숨겨진 광고 날짜 2030-01-01</div><footer>메뉴</footer>'}
    text = service.parse_page(job_markup(data), "text/html", JOB_URL).text
    assert "제출 서류" in text
    assert "secret" not in text and "2030-01-01" not in text and "메뉴" not in text


def test_metadata_budget_and_graph_limits_preserve_existing_visible_body(monkeypatch):
    monkeypatch.setattr(service, "MAX_JSON_LD", 10)
    assert service.parse_page(job_markup(), "text/html", JOB_URL).text == "공개 공고"
    monkeypatch.setattr(service, "MAX_JSON_LD", 100_000)
    assert service.parse_page(job_markup([JOB] * 129), "text/html", JOB_URL).text == "공개 공고"
    graph = JOB
    for _ in range(10):
        graph = {"@graph": graph}
    assert service.parse_page(job_markup(graph), "text/html", JOB_URL).text == "공개 공고"
    monkeypatch.setattr(service, "MAX_TEXT", 20)
    with pytest.raises(service.ExtractionError, match="text_too_large"):
        service.parse_page(job_markup(), "text/html", JOB_URL)


def test_extract_uses_fetched_identity_and_does_not_fetch_metadata_links(monkeypatch):
    fetched = []
    monkeypatch.setattr(service, "public_target", lambda *a: ("www.jobkorea.co.kr", 443, "8.8.8.8"))
    monkeypatch.setattr(service, "check_robots", lambda *a: None)
    def fetch(url, deadline):
        fetched.append(url)
        return 200, {"content-type": "text/html"}, job_markup()
    monkeypatch.setattr(service, "fetch_once", fetch)
    assert "2026-10-31T23:59" in service.extract("url", JOB_URL, None).text
    assert fetched == [JOB_URL]
