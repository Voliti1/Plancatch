"""Summarize analyzed files and find reusable records owned by the uploader."""
import re
import unicodedata
from datetime import timezone

from sqlalchemy import case, select
from sqlalchemy.orm import Session

from app.models.analysis import Analysis
from app.models.source import Source
from app.models.user import User
from app.schemas.analysis import FileResult
from app.services.source_images import file_hash

HEADING = re.compile(r"^(?:\[[^\]]{1,20}\]\s*)?20\d{2}(?:\s*년(?:도)?)?\s+.{0,150}(?:채용|모집|공모|공채)(?:\s|$)")
EMPLOYER = re.compile(
    r"^((?:[A-Z]{2,8}\s*)?[^\W\d_][\w&.-]{1,29})\s+(?:신입(?:사원)?|경력(?:사원)?|인턴)\s+(?:공개\s*)?(?:채용|공채)(?:\s|$)"
)
ISSUER = re.compile(r"^([^\W\d_][\w&.-]{1,39})\s+공고\s*제\s*20\d{2}\s*[-–—]")
INTRODUCTION = re.compile(r"^([^\W\d_][\w&.-]{1,29})(?:은|는)\s+[^.!?]{2,80}\s+자회사로서(?:\s|$)")
COMPANY_LABEL = re.compile(
    r"^(?:회사명|기업명|업체명|채용 회사|채용 기관명)(?:\s*[:：]\s*(.*)|\s+(.+))?$"
)
CORPORATE_NAME = re.compile(r"^(?:(?:\(주\)|㈜|주식회사)\s*\S+|\S+\s*(?:\(주\)|㈜))$")


def filename_label(filename: str | None, fallback: str) -> str:
    basename = (filename or "").replace("\\", "/").rsplit("/", 1)[-1]
    name = unicodedata.normalize("NFC", re.sub(r"[\x00-\x1f\x7f]", "", basename)).strip()
    return name[:255] or fallback


def file_summary(transcript: str, candidate_title: str | None = None) -> tuple[str | None, str | None]:
    lines = [line for raw in transcript.splitlines() if (line := " ".join(raw.split()))]
    header = lines[:8]
    title = None
    companies = []
    for index, line in enumerate(header):
        if title is None and HEADING.search(line):
            title = line
            if index + 1 < len(header) and re.fullmatch(r"\([^)]{1,100}\)\s*공고", header[index + 1]):
                title += " " + header[index + 1]
        heading = re.sub(r"^(?:20\d{2}(?:\s*년(?:도)?)?\s*)?(?:[상하]반기\s*)?", "", line)
        match = ISSUER.match(line) or INTRODUCTION.match(line) or EMPLOYER.match(heading)
        if match:
            companies.append(match[1])
    labelled = []
    corporate_names = []
    for index, line in enumerate(lines):
        if match := COMPANY_LABEL.match(line):
            value = match[1] or match[2] or (lines[index + 1] if index + 1 < len(lines) else "")
            if value and len(value) <= 80 and not re.match(r"마감|접수|지원|https?:", value):
                labelled.append(value)
        if len(line) <= 80 and CORPORATE_NAME.fullmatch(line) and not re.search(r"모집|공고|마감|[<>]", line):
            corporate_names.append(line)
    unique = {normalize(value): value for value in labelled or corporate_names or companies}
    if not title and candidate_title and candidate_title not in {"접수 마감", "지원서 접수 마감", "원서접수"}:
        title = candidate_title
    return title[:255] if title else None, next(iter(unique.values())) if len(unique) == 1 else None


def analyze_metadata(result: FileResult, *, title_entered: bool) -> dict:
    candidate_title = result.deadlines[0].title if len(result.deadlines) == 1 else None
    title, company = file_summary(result.transcript, candidate_title)
    deadlines = sorted({item.due_at.astimezone(timezone.utc).isoformat()
                        for item in result.deadlines if item.due_at is not None})
    return {"title_entered": title_entered, "document_title": title, "company_name": company,
            "deadlines": deadlines, "dates_complete": bool(deadlines) and all(item.due_at for item in result.deadlines)}


def normalize(value: str) -> str:
    return " ".join(unicodedata.normalize("NFC", value).split()).casefold()


def metadata_key(value: dict | None) -> tuple | None:
    if not value or not (value.get("document_title") and value.get("company_name") and value.get("dates_complete")):
        return None
    return normalize(value["document_title"]), normalize(value["company_name"]), tuple(value["deadlines"])


def lock_file_owner(db: Session, user_id) -> None:
    db.execute(select(User.id).where(User.id == user_id).with_for_update()).scalar_one_or_none()


def reusable_files(db: Session, user_id, source_type: str, filename: str):
    return db.scalars(select(Source).where(
        Source.user_id == user_id, Source.source_type == source_type, Source.original_filename == filename,
        Source.processing_status.in_(("extracted", "completed")),
    ).order_by(Source.created_at, Source.id).with_for_update(skip_locked=True))


def reusable_review(db: Session, source: Source) -> Analysis | None:
    return db.scalar(select(Analysis).where(
        Analysis.source_id == source.id, Analysis.user_id == source.user_id,
        Analysis.input_hash == file_hash(source.storage_key, source.source_type),
        Analysis.model.startswith(f"{source.source_type}:"),
        Analysis.status.in_(("ready", "approved")), Analysis.reused_analysis_id.is_(None),
        (Analysis.status == "approved") | (Analysis.input_text == source.extracted_text),
    ).order_by(case((Analysis.status == "approved", 0), else_=1), Analysis.created_at.desc(), Analysis.id).limit(1))
