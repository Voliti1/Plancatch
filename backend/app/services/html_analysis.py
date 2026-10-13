"""Deterministic URL-only Saramin analysis; never calls or impersonates an AI provider."""
from urllib.parse import parse_qs, urlsplit

from app.schemas.analysis import ProviderResult
from app.services.saramin_period import (
    CONFLICT,
    END_MARKER,
    MARKER,
    UNRESOLVED,
    is_job_url,
    read_period,
)

HTML_MODEL = "html:saramin:v1"


def matching_period(text: str, source_url: str | None) -> dict | None:
    """Bind the fetched HTML job to the submitted URL, including canonical relay URLs."""
    period = read_period(text)
    fetched_url = period["source_url"] if period else None
    if not source_url or not fetched_url or not is_job_url(source_url) or not is_job_url(fetched_url):
        return None
    # Both URLs have already passed the official host/path/single numeric ID
    # checks. Tracking parameters or the public relay/canonical view may differ.
    submitted = parse_qs(urlsplit(source_url).query, max_num_fields=100)["rec_idx"]
    fetched = parse_qs(urlsplit(fetched_url).query, max_num_fields=100)["rec_idx"]
    return period if submitted == fetched else None


def analyze_period(text: str, source_url: str, title: str | None) -> ProviderResult:
    period = matching_period(text, source_url)
    if period is None:
        raise ValueError("HTML snapshot no longer matches its source")
    due_at = period["deadline_at"]
    if due_at:
        evidence = f"마감일 원문: {period['end_text']}"
    else:
        # Ambiguous or open-ended periods still produce a review-only result,
        # without asking a generative model to guess a closing time.
        evidence = MARKER + text.split(MARKER, 1)[1].split(END_MARKER, 1)[0]
        evidence = evidence[:2000].strip()
    assert evidence in text
    return ProviderResult(deadlines=[{
        "title": (title or "").strip() or "채용 공고 접수 마감",
        "due_at": due_at,
        "description": None,
        "evidence_text": evidence,
        # Compatibility field only; the UI labels this as HTML, not AI confidence.
        "confidence": 1.0 if due_at else 0.0,
    }], warnings=[CONFLICT if period["has_conflict"] else UNRESOLVED] if not due_at else [])
