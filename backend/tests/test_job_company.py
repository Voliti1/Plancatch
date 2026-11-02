"""Same-job company slots; no live network, model calls or user database."""
import json

import pytest

from app.services.extraction import parse_page
from app.services.url_deadlines import append_snapshot, review_data
from tests.test_catch_period import URL, markup
from tests.test_jasoseol_period import URL as JASOSEOL_URL
from tests.test_jasoseol_period import markup as jasoseol_markup
from tests.test_jasoseol_period import next_data


def company(html, url=URL):
    document = parse_page(html.encode(), "text/html; charset=utf-8", url)
    saved = append_snapshot(document.text, url, url, document.review)
    return review_data(saved, url)["company_name"]


def anchor(name="농심", identity="574650", href="/Comp/CompSummary/310123", attrs=""):
    return (f'<div class="printArea_{identity}" {attrs}><a href="{href}" '
            f'class="name gtm-recruitDetail-compInfo-click"><span>{name}</span></a></div>')


def test_catch_fixed_slot_wins_over_recommended_body_and_unrelated_company_labels():
    html = markup(extra_html=anchor() + anchor("추천기업", identity="999999")
                  + '<p>회사명: 광고 기업</p>' + anchor())
    assert company(html) == "농심"


@pytest.mark.parametrize("attrs", ["hidden", 'aria-hidden="true"', 'style="display:none"'])
def test_hidden_catch_company_slots_are_not_facts(attrs):
    assert company(markup(extra_html=anchor(attrs=attrs))) is None


@pytest.mark.parametrize("href", ["https://evil.example/Comp/CompSummary/310123", "http://[",
                                 "/NCS/RecruitInfoDetails/999999", "javascript:alert(1)"])
def test_untrusted_links_do_not_supply_a_company_or_break_extraction(href):
    assert company(markup(extra_html=anchor(href=href))) is None


def test_conflicting_slot_names_and_mismatched_job_identity_do_not_pick_arbitrarily():
    assert company(markup(extra_html=anchor() + anchor("다른기업"))) is None
    assert company(markup(extra_html=anchor(), canonical=URL.replace("574650", "999999"))) is None


def test_same_job_metadata_is_a_bounded_fallback_without_the_visible_slot():
    html = markup().replace('"validThrough":', '"hiringOrganization":{"name":"캐치 메타기업"},"validThrough":')
    assert company(html) == "캐치 메타기업"
    foreign = html.replace('"hiringOrganization":', '"mainEntityOfPage":{"@id":"https://www.catch.co.kr/NCS/RecruitInfoDetails/999999"},"hiringOrganization":')
    assert company(foreign) is None


def test_saramin_reads_company_name_only_inside_the_exact_job_company_section():
    url = "https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=55170548"
    def slot(identity, name):
        return (f'<div class="jv_cont jv_company company_info_wrap_{identity}">'
                f'<a class="company_name ga_data_layer" href="/zf_user/company-info/view?csn=company">{name}</a></div>')
    html = '<main>공개 공고</main>' + slot("999999", "다른 회사") + slot("55170548", "(주)켐트로닉스")
    assert company(html, url) == "(주)켐트로닉스"
    assert company(html, url.replace("55170548", "222222")) is None


def test_jasoseol_uses_its_exact_initial_employment_company_not_sidebar_data():
    data = next_data()
    data["props"]["pageProps"]["initialEmploymentCompany"]["name"] = "피에스케이"
    assert company(jasoseol_markup(data), JASOSEOL_URL) == "피에스케이"
    data["props"]["pageProps"]["initialEmploymentCompany"]["id"] = 999999
    assert company(jasoseol_markup(data), JASOSEOL_URL) is None


@pytest.mark.parametrize("url,site", [
    ("https://www.jobkorea.co.kr/Recruit/GI_Read/50195748", "jobkorea"),
    ("https://linkareer.com/activity/356174", "linkareer"),
    ("https://www.jobplanet.co.kr/job/search?posting_ids[]=1776386", "jobplanet"),
])
def test_other_site_same_job_organization_is_kept_but_foreign_records_are_excluded(url, site):
    title = "테스트 공고"
    job = {"@type":"JobPosting", "title":title, "url":url, "hiringOrganization":{"name":"공고 기업"}}
    def doc(item):
        return (f'<html><head><link rel="canonical" href="{url}">'
                + '<script type="application/ld+json">' + json.dumps(item) + '</script></head>'
                + f'<body><main><h1>{title}</h1>공개 본문</main></body></html>')
    assert company(doc(job), url) == "공고 기업"
    job["url"] = "https://example.com/unrelated"
    assert company(doc(job), url) is None


def test_malformed_company_text_cannot_break_snapshot_or_db_encoding():
    assert company(markup(extra_html=anchor("가" * 201))) is None
    html = markup().replace('"validThrough":', '"hiringOrganization":{"name":"\\ud800"},"validThrough":')
    assert company(html) is None
