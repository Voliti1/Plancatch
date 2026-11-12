"""Semantic old headhunting field ownership, duplicate metadata, no iframe/network."""
import pytest

from app.services.extraction import parse_page
from app.services.url_deadlines import analyze_url, append_snapshot

URL = 'https://www.jobkorea.co.kr/Recruit/GI_Read/50325319'


def markup(closing='2026.12.07', canonical=URL, second=None, wrapper=''):
    return (f'<html><head><title>테스트기업 채용</title><link rel="canonical" href="{canonical}">'
        f'<meta name="description" content="경력 : 3년이상, 마감일 : {closing}">'
        f'<meta property="og:description" content="경력 : 3년이상, 마감일 : {second or closing}"></head>'
        f'<body><div {wrapper}><div class="gibReadDetailView"><h2>접수기간/방법</h2>'
        '<iframe src="/ignored"></iframe></div></div><aside>마감일 2030.12.31</aside></body></html>')


def analyzed(html, url=URL):
    doc= parse_page(html.encode(), 'text/html', url)
    return analyze_url(append_snapshot(doc.text,url,url,doc.review),url,None)


def test_owned_dedicated_metadata_date_is_reviewable_with_the_missing_time_notice():
    result=analyzed(markup())
    assert result.deadlines[0].due_at.isoformat()=='2026-12-07T23:59:00+09:00'
    assert any('11시 59분' in item for item in result.warnings)
    assert '공고 메타 설명 마감일' in result.deadlines[0].evidence_text


@pytest.mark.parametrize('kwargs', [
    {'canonical':URL.replace('50325319','999999')},
    {'wrapper':'hidden'}, {'closing':'2026.02.30'}, {'second':'2026.12.08'},
])
def test_unowned_hidden_invalid_or_conflicting_fields_never_prefill(kwargs):
    assert analyzed(markup(**kwargs)).deadlines[0].due_at is None


def test_navigation_cannot_claim_the_legacy_primary_layout():
    html = markup().replace('<div ><div class="gibReadDetailView">', '<nav><div class="gibReadDetailView">').replace('</iframe></div></div>', '</iframe></div></nav>')
    assert analyzed(html).deadlines[0].due_at is None


def test_explicit_open_ended_metadata_never_uses_another_fields_date():
    result=analyzed(markup(closing='채용 시 마감'))
    assert result.deadlines[0].due_at is None
    assert any('채용 시 마감' in item for item in result.warnings)
