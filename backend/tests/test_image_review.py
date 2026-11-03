"""Synthetic image transport plus actual owner-scoped upload/review/approval routes."""
import base64
import io
import json
import uuid
from types import SimpleNamespace

import pytest
from PIL import Image
from pydantic import SecretStr

from app.services import ai_analysis, image_analysis, source_images
from tests.test_sources import auth_headers, client, configure_test_jwt  # noqa: F401

TEXT = "공통지원자격\n2027년 2월 졸업예정자 및 기졸업자\n접수기간 2026년 10월 21일(수) ~ 11월 01일(일) 까지\n면접일정 별도 통지"
EVIDENCE = "접수기간 2026년 10월 21일(수) ~ 11월 01일(일) 까지"


def picture(fmt="PNG"):
    out = io.BytesIO()
    Image.new("RGB", (300, 180), "white").save(out, format=fmt)
    return out.getvalue()


@pytest.fixture(autouse=True)
def private_storage(tmp_path, monkeypatch):
    monkeypatch.setattr(source_images, "ROOT", tmp_path / "private")
    monkeypatch.setattr(ai_analysis, "get_settings", lambda: SimpleNamespace(
        gemini_api_key=SecretStr("test-only-key"), gemini_model="test-model"))


def auth():
    return auth_headers("image-" + uuid.uuid4().hex + "@example.com")


def upload(headers, content=None):
    response = client.post("/api/sources/images", headers=headers,
        files={"file": ("notice.png", content or picture(), "image/png")})
    assert response.status_code == 201
    return response.json()


def result(due=None):
    return {"transcript":TEXT,"deadlines":[{"title":"접수 마감", "due_at":due,
        "description":"11월 1일 마감, 시각은 사진에 없습니다.", "evidence_text":EVIDENCE,
        "confidence":0.9}],"warnings":["사진에 공고 제목과 마감 시각이 없습니다."]}


def mock_provider(monkeypatch, value):
    calls = []
    def respond(payload, model):
        assert payload["contents"][0]["parts"][1]["inlineData"]["mimeType"] == "image/png"
        with Image.open(io.BytesIO(base64.b64decode(payload["contents"][0]["parts"][1]["inlineData"]["data"]))) as sent:
            assert sent.format == "PNG"
        calls.append(model)
        return {"candidates":[{"finishReason":"STOP","content":{"parts":[{"text":json.dumps(value)}]}}]}
    monkeypatch.setattr(image_analysis, "provider_request", respond)
    return calls


@pytest.mark.parametrize("title", ["일정 제목", "일" * 255, ""])
def test_image_schedule_title_reaches_candidates_and_can_be_edited(monkeypatch, title):
    mock_provider(monkeypatch, result("2026-11-01T23:59:00+09:00"))
    headers = auth()
    source = client.post("/api/sources/images", headers=headers,
                        files={"file": ("notice.png", picture(), "image/png")},
                        data={"title": title}).json()
    started = client.post("/api/sources/" + source["id"] + "/ai-analyses", headers=headers,
                          json={"allow_external_ai": True, "input_hash": source["image_sha256"]})
    path = "/api/ai-analyses/" + started.json()["id"]
    candidate = client.get(path, headers=headers).json()["candidates"][0]
    assert candidate["title"] == (title or "접수 마감")
    assert candidate["evidence_text"] == EVIDENCE
    edit = {key: candidate[key] for key in ("id", "title", "due_at", "description", "selected")}
    edit.update(title="검토 후 바꾼 일정 제목", selected=True)
    saved = client.patch(path, headers=headers, json={"revision": 1, "candidates": [edit]})
    assert saved.status_code == 200
    approved = client.post(path + "/approve", headers=headers, json={"revision": 2})
    assert approved.status_code == 200
    deadline = client.get("/api/deadlines/" + approved.json()["approved_deadline_ids"][0], headers=headers).json()
    assert deadline["title"] == "검토 후 바꾼 일정 제목"
    assert client.get(path, headers=headers).json()["candidates"][0]["title"] == deadline["title"]


def test_date_only_crop_defaults_time_but_still_requires_selection_and_review(monkeypatch):
    calls = mock_provider(monkeypatch, result())
    headers = auth()
    source = upload(headers)
    path = "/api/sources/" + source["id"]
    assert len(source["image_sha256"]) == 64
    assert client.get(path + "/image").status_code == 401
    assert client.get(path + "/image", headers=auth()).status_code == 404
    response = client.get(path + "/image",headers=headers)
    assert response.headers["cache-control"] == "no-store" and response.content.startswith(b"\x89PNG")
    assert calls == []
    payload = {"input_hash":source["image_sha256"],"reuse_existing":True}
    assert client.post(path+"/ai-analyses",headers=headers,json=payload).status_code == 422
    assert client.post(path+"/analyze",headers=headers).status_code == 422
    assert client.post(path+"/ai-analyses",headers=headers,json={**payload,"allow_external_ai":True,"input_hash":"0"*64}).status_code == 409
    started = client.post(path+"/ai-analyses",headers=headers,json={**payload,"allow_external_ai":True})
    assert started.status_code == 202
    apath = "/api/ai-analyses/" + started.json()["id"]
    analysis = client.get(apath,headers=headers).json()
    assert analysis["status"] == "ready" and len(calls) == 1
    assert analysis["candidates"][0]["due_at"] == "2026-11-01T23:59:00+09:00"
    assert analysis["candidates"][0]["time_defaulted"]
    assert not analysis["candidates"][0]["selected"]
    assert analysis["date_choices"][0]["date"] == "2026-11-01"
    assert analysis["date_choices"][0]["due_at"] == "2026-11-01T23:59:00+09:00"
    assert client.post(path+"/ai-analyses",headers=headers,json={**payload,"allow_external_ai":True}).json()["id"] == analysis["id"]
    assert len(calls) == 1
    assert client.post(apath+"/approve",headers=headers,json={"revision":1}).status_code == 422
    assert client.post(apath+"/auto-register",headers=headers,json={"revision":1,"title":"임의 제목","confirm_auto_registration":True}).status_code == 422
    proposal = analysis["candidates"][0]
    edit = {key:proposal[key] for key in ("id","title","due_at","description","selected")}
    edit.update(title="직접 정한 제목",due_at="2026-11-01T18:00:00+09:00",selected=True)
    assert client.patch(apath,headers=headers,json={"revision":1,"candidates":[edit]}).status_code == 200
    approved = client.post(apath+"/approve",headers=headers,json={"revision":2})
    assert approved.status_code == 200
    assert client.delete(path,headers=headers).status_code == 409
    assert client.get(path+"/image",headers=headers).status_code == 200
    identity = approved.json()["approved_deadline_ids"][0]
    assert client.post(apath+"/approve",headers=headers,json={"revision":2}).json()["approved_deadline_ids"] == [identity]
    assert client.delete("/api/deadlines/"+identity,headers=headers).status_code == 204
    key = source["storage_key"]
    assert client.get(path,headers=headers).status_code == 404
    assert not source_images.file_path(key).exists()


@pytest.mark.parametrize("data", [b"not an image",b"<svg onload='alert(1)'/>", b"%PDF-1.4"])
def test_invalid_uploads_do_not_create_source_or_send_ai(data):
    headers = auth()
    assert client.post("/api/sources/images",headers=headers,files={"file":("fake.png",data,"image/png")}).status_code == 422
    assert client.get("/api/sources",headers=headers).json() == []


def test_pdf_upload_requires_consent_and_keeps_distinct_deadline_candidates(monkeypatch):
    headers = auth()
    pdf = picture("PDF")
    first = "서류 접수 마감 11.09 18:00"
    second = "추가 서류 제출 마감 2026.11.12 17:00"
    proposals = [
        {"title": title, "due_at": None, "description": None,
         "evidence_text": evidence, "confidence": 0.9}
        for title, evidence in [("서류 접수", first), ("추가 서류 제출", second)]
    ]
    calls = []

    def respond(payload, model):
        inline = payload["contents"][0]["parts"][1]["inlineData"]
        assert inline["mimeType"] == "application/pdf"
        assert base64.b64decode(inline["data"]) == pdf
        calls.append(model)
        value = {"transcript": "2026년 채용 공고\n" + first + "\n" + second.replace("마감 2026", "마감\n2026"),
                 "deadlines": [*proposals, dict(proposals[0], evidence_text="문서에 없는 근거 2026.11.30")],
                 "warnings": []}
        return {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": json.dumps(value)}]}}]}

    monkeypatch.setattr(image_analysis, "provider_request", respond)
    upload_path = "/api/sources/pdfs"
    assert client.post(upload_path, files={"file": ("notice.pdf", pdf)}).status_code == 401
    bad = client.post(upload_path, headers=headers, files={"file": ("fake.pdf", b"%PDF-1.4\nno trailer")})
    assert bad.status_code == 422
    oversized = client.post(upload_path, headers=headers,
        files={"file": ("large.pdf", b"x" * (source_images.MAX_BYTES + 1))})
    assert oversized.status_code == 422
    saved = client.post(upload_path, headers=headers, files={"file": ("notice.pdf", pdf)})
    assert saved.status_code == 201
    source = saved.json()
    assert source["source_type"] == "pdf" and len(source["pdf_sha256"]) == 64
    source_path = "/api/sources/" + source["id"]
    assert client.get(source_path, headers=auth()).status_code == 404
    assert client.get(source_path + "/image", headers=headers).status_code == 404
    assert client.post(source_path + "/analyze", headers=headers).status_code == 422
    analysis_route = source_path + "/ai-analyses"
    payload = {"input_hash": source["pdf_sha256"], "reuse_existing": True}
    assert client.post(analysis_route, headers=headers, json=payload).status_code == 422
    assert client.post(analysis_route, headers=headers, json={**payload, "allow_external_ai": True,
                       "input_hash": "0" * 64}).status_code == 409
    assert calls == []
    payload["allow_external_ai"] = True
    started = client.post(analysis_route, headers=headers, json=payload)
    assert started.status_code == 202
    analysis_path = "/api/ai-analyses/" + started.json()["id"]
    analysis = client.get(analysis_path, headers=headers).json()
    assert analysis["status"] == "ready" and analysis["model"].startswith("pdf:")
    assert [(c["title"], c["due_at"], c["selected"]) for c in analysis["candidates"]] == [
        ("서류 접수", "2026-11-09T18:00:00+09:00", False),
        ("추가 서류 제출", "2026-11-12T17:00:00+09:00", False),
    ]
    assert any("근거 문구를 확인하지 못한 후보" in warning for warning in analysis["warnings"])
    assert client.post(analysis_route, headers=headers, json=payload).json()["id"] == analysis["id"]
    assert calls == ["test-model"]
    assert client.get("/api/deadlines", headers=headers).json() == []
    auto = client.post(analysis_path + "/auto-register", headers=headers,
                       json={"revision": 1, "title": "PDF", "confirm_auto_registration": True})
    assert auto.status_code == 422 and auto.json()["detail"] == "pdf_registration_requires_review"
    candidates = [{key: c[key] for key in ("id", "title", "due_at", "description", "selected")}
                  for c in analysis["candidates"]]
    candidates[1]["selected"] = True
    assert client.patch(analysis_path, headers=headers, json={"revision": 1, "candidates": candidates}).status_code == 200
    approved = client.post(analysis_path + "/approve", headers=headers, json={"revision": 2})
    assert approved.status_code == 200
    deadlines = client.get("/api/deadlines", headers=headers).json()
    assert [d["title"] for d in deadlines] == ["추가 서류 제출"]
    assert client.delete(source_path, headers=headers).status_code == 409
    assert client.delete("/api/deadlines/" + deadlines[0]["id"], headers=headers).status_code == 204
    assert not source_images.file_path(source["storage_key"]).exists()


def test_limits_and_integrity_are_enforced(monkeypatch):
    with pytest.raises(ValueError): source_images.normalize_image(b"x"*(source_images.MAX_BYTES+1))
    monkeypatch.setattr(source_images,"MAX_PIXELS",10)
    with pytest.raises(ValueError): source_images.normalize_image(picture())
    monkeypatch.setattr(source_images,"MAX_PIXELS",12_000_000)
    headers = auth()
    source = upload(headers,picture("JPEG"))
    path = source_images.file_path(source["storage_key"])
    path.write_bytes(b"changed")
    assert client.get('/api/sources/'+source['id']+'/image',headers=headers).status_code == 404
    with pytest.raises(ValueError): source_images.file_path("../../.env")


def test_pdf_heading_year_recovers_saved_review_without_reanalysis(monkeypatch):
    from app.models import Analysis, Source
    from app.services.deadline_dates import (
        UNRESOLVED_FILE_CANDIDATE,
        UNRESOLVED_FILE_TIME,
    )
    from tests.test_auth import TestingSession

    headers = auth()
    source = client.post("/api/sources/pdfs", headers=headers,
                         files={"file": ("notice.pdf", picture("PDF"))}).json()
    evidence = "9.22(월) ~ 10.1(수) 17:00"
    transcript = "2025 하반기 SK하이닉스 신입사원 채용\n지원서 접수\n" + evidence
    with TestingSession() as db:
        owner = db.get(Source, uuid.UUID(source["id"])).user_id
        saved = Analysis(user_id=owner, source_id=uuid.UUID(source["id"]), input_text=transcript,
                         input_hash=source["pdf_sha256"], model="pdf:test-model", status="ready",
                         candidates=[{"id": str(uuid.uuid4()), "title": "SK하이닉스 지원서 접수", "selected": False,
                                      "due_at": None, "evidence_text": evidence, "confidence": 0.9}],
                         warnings=[UNRESOLVED_FILE_TIME, UNRESOLVED_FILE_CANDIDATE])
        db.add(saved)
        db.commit()
        identity = saved.id

    def unexpected_request(*args):
        pytest.fail("Opening an existing review must not call Gemini")

    monkeypatch.setattr(image_analysis, "provider_request", unexpected_request)
    response = client.get(f"/api/ai-analyses/{identity}", headers=headers).json()
    assert response["candidates"][0]["suggested_due_at"] == "2025-10-01T17:00:00+09:00"
    assert response["warnings"] == []
    with TestingSession() as db:
        assert db.get(Analysis, identity).candidates[0]["due_at"] is None


@pytest.mark.parametrize("heading,evidence", [
    ("SK하이닉스 신입사원 채용", "9.22(월) ~ 10.1(수) 17:00"),
    ("2025년 채용 공고\n2026년 채용 공고", "9.22(월) ~ 10.1(수) 17:00"),
    ("2025년 채용 공고", "9.22(화) ~ 10.1(수) 17:00"),
    ("2025년 채용 공고", "12.29(월) ~ 1.1(목) 17:00"),
])
def test_pdf_year_fallback_rejects_ambiguous_or_conflicting_dates(heading, evidence):
    from app.services.deadline_dates import closing_choice, pdf_document_year

    assert closing_choice(evidence, document_year=pdf_document_year(heading))["due_at"] is None


def test_bad_evidence_fails_safely_and_explicit_time_is_grounded(monkeypatch):
    value = result()
    value["deadlines"][0]["evidence_text"] = "not in image transcript"
    mock_provider(monkeypatch,value)
    with pytest.raises(ai_analysis.AIError,match="ai_evidence_not_in_source"):
        image_analysis.analyze_file(picture(),"test-model","image")
    value = result("2026-11-01T18:00:00+09:00")
    value["transcript"] = value["deadlines"][0]["evidence_text"] = "접수 마감 2026년 11월 1일 18:00"
    mock_provider(monkeypatch,value)
    assert image_analysis.analyze_file(picture(),"test-model","image").deadlines[0].due_at.hour == 18


@pytest.mark.parametrize("evidence", [
    "2026년 10월 27일(화) 오후 5시(한국시간)까지 제출하셔야 합니다.",
    "2026년 10월 15일(목) ~ 10월 27일(화) 오후 5시",
])
@pytest.mark.parametrize("provider_due", [None, "2026-10-27T17:00:00+09:00"])
def test_screenshot_korean_pm_clock_is_not_discarded(monkeypatch, evidence, provider_due):
    value = result(provider_due)
    value["transcript"] = value["deadlines"][0]["evidence_text"] = evidence
    value["warnings"] = ["마감 시간(시, 분)이 명시되어 있지 않아 due_at을 null로 처리했습니다."]
    mock_provider(monkeypatch, value)
    parsed = image_analysis.analyze_file(picture(), "test-model", "image")
    assert parsed.deadlines[0].due_at.isoformat() == "2026-10-27T17:00:00+09:00"
    assert not any("due_at" in item or "null" in item for item in parsed.warnings)
    assert not any("11시 59분" in item for item in parsed.warnings)


@pytest.mark.parametrize("clock", ["18:00", "18시", "18시 00분", "오후 6시"])
@pytest.mark.parametrize("model_due", [None, "2026-11-09T23:59:00+09:00", "2026-11-09T18:00:00+09:00"])
def test_linkareer_capture_clock_overrides_a_false_model_default(monkeypatch, clock, model_due):
    from app.services.deadline_dates import DEFAULT_TIME_NOTICE
    evidence = f"접수기간: 2026. 11. 3.(화) 10:00 ~ 11. 9.(월) {clock}까지"
    value = result(model_due)
    value["transcript"] = "지원자격: 2009. 2. 4. 이전 출생\n입사지원서 접수\n" + evidence
    value["deadlines"][0]["evidence_text"] = evidence
    value["warnings"] = [DEFAULT_TIME_NOTICE]
    mock_provider(monkeypatch, value)
    parsed = image_analysis.analyze_file(picture(), "test-model", "image")
    assert parsed.deadlines[0].due_at.isoformat() == "2026-11-09T18:00:00+09:00"
    assert DEFAULT_TIME_NOTICE not in parsed.warnings


def test_image_date_only_quote_includes_its_adjacent_transcribed_clock(monkeypatch):
    evidence = "접수 마감 2026. 11. 9.(월)"
    value = result("2026-11-09T23:59:00+09:00")
    value["transcript"] = evidence + " 18:00까지 제출하세요."
    value["deadlines"][0]["evidence_text"] = evidence
    mock_provider(monkeypatch, value)
    parsed = image_analysis.analyze_file(picture(), "test-model", "image")
    assert parsed.deadlines[0].due_at.isoformat() == "2026-11-09T18:00:00+09:00"
    assert parsed.deadlines[0].evidence_text == evidence + " 18:00"


@pytest.mark.parametrize("status,revision", [("ready", 1), ("ready", 2), ("approved", 1)])
def test_old_false_default_is_only_suggested_for_an_untouched_image_review(monkeypatch, status, revision):
    from app.models import Analysis
    from app.services.deadline_dates import DEFAULT_TIME_NOTICE
    from tests.test_auth import TestingSession

    evidence = "접수기간: 2026. 11. 3.(화) 10:00 ~ 11. 9.(월) 18:00까지"
    value = result()
    value["transcript"] = value["deadlines"][0]["evidence_text"] = evidence
    mock_provider(monkeypatch, value)
    headers = auth()
    source = upload(headers)
    started = client.post("/api/sources/" + source["id"] + "/ai-analyses", headers=headers,
                         json={"allow_external_ai": True, "input_hash": source["image_sha256"], "reuse_existing": True})
    identity = started.json()["id"]
    with TestingSession() as db:
        analysis = db.get(Analysis, uuid.UUID(identity))
        analysis.candidates = [dict(analysis.candidates[0], due_at="2026-11-09T23:59:00+09:00")]
        analysis.warnings = [DEFAULT_TIME_NOTICE]
        analysis.status, analysis.revision = status, revision
        db.commit()
    path = "/api/ai-analyses/" + identity
    data = client.get(path, headers=headers).json()
    candidate = data["candidates"][0]
    assert candidate["due_at"] == "2026-11-09T23:59:00+09:00"
    assert not candidate["time_defaulted"]
    with TestingSession() as db:
        assert db.get(Analysis, uuid.UUID(identity)).candidates[0]["due_at"] == candidate["due_at"]
    if (status, revision) == ("ready", 1):
        assert candidate["suggested_due_at"] == "2026-11-09T18:00:00+09:00"
        edit = {key: candidate[key] for key in ("id", "title", "due_at", "description", "selected")}
        edit.update(due_at=candidate["suggested_due_at"], selected=True)
        saved = client.patch(path, headers=headers, json={"revision": 1, "candidates": [edit]})
        assert saved.status_code == 200
        approved = client.post(path + "/approve", headers=headers, json={"revision": 2})
        assert approved.status_code == 200
        deadline = client.get("/api/deadlines/" + approved.json()["approved_deadline_ids"][0], headers=headers).json()
        assert deadline["due_at"].startswith("2026-11-09T18:00:00")
    else:
        assert candidate["suggested_due_at"] is None
        assert any("저장된 시간이 다릅니다" in item for item in data["warnings"])


def test_old_image_review_suggests_verified_clock_without_writing_or_retransmission(monkeypatch):
    from app.models import Analysis
    from tests.test_auth import TestingSession

    calls = mock_provider(monkeypatch, result())
    headers = auth()
    source = upload(headers)
    request = {"allow_external_ai": True, "input_hash": source["image_sha256"], "reuse_existing": True}
    started = client.post("/api/sources/" + source["id"] + "/ai-analyses", headers=headers, json=request)
    analysis_id = started.json()["id"]
    evidence = "2026년 10월 27일(화) 오후 5시(한국시간)까지 제출하셔야 합니다."
    with TestingSession() as db:
        saved = db.get(Analysis, uuid.UUID(analysis_id))
        saved.input_text = evidence
        saved.candidates = [dict(saved.candidates[0], due_at=None, evidence_text=evidence)]
        db.commit()
    path = "/api/ai-analyses/" + analysis_id
    data = client.get(path, headers=headers).json()
    assert data["candidates"][0]["due_at"] is None
    assert data["candidates"][0]["suggested_due_at"] == "2026-10-27T17:00:00+09:00"
    assert len(calls) == 1 and data["revision"] == 1
    with TestingSession() as db:
        assert db.get(Analysis, uuid.UUID(analysis_id)).candidates[0]["due_at"] is None
    edit = {key: data["candidates"][0][key] for key in ("id", "title", "due_at", "description", "selected")}
    # User clearing a suggestion and saving must not cause it to reappear.
    response = client.patch(path, headers=headers, json={"revision": 1, "candidates": [edit]})
    assert response.status_code == 200
    assert response.json()["candidates"][0]["suggested_due_at"] is None


def test_failed_image_result_is_reused_until_explicit_consented_retry(monkeypatch):
    calls = []
    def unavailable(*_):
        calls.append(1)
        raise ai_analysis.AIError("ai_timeout")
    monkeypatch.setattr(image_analysis,"provider_request",unavailable)
    headers = auth()
    source = upload(headers)
    path = '/api/sources/'+source['id']+'/ai-analyses'
    payload = {'allow_external_ai':True,'input_hash':source['image_sha256'],'reuse_existing':True}
    first = client.post(path,headers=headers,json=payload)
    assert first.status_code == 202
    analysis = client.get('/api/ai-analyses/'+first.json()['id'],headers=headers).json()
    assert analysis['status'] == 'failed' and analysis['error_message'] == 'ai_timeout'
    assert client.post(path,headers=headers,json=payload).json()['id'] == analysis['id']
    assert len(calls) == 1
    mock_provider(monkeypatch,result())
    new = client.post(path,headers=headers,json={**payload,'reuse_existing':False})
    assert new.status_code == 202 and new.json()['id'] != analysis['id']
    assert client.get('/api/ai-analyses/'+new.json()['id'],headers=headers).json()['status'] == 'ready'


def test_year_crossing_without_year_and_multiple_dates_remain_unresolved():
    assert image_analysis.closing_choice('접수기간 2026년 12월 21일 ~ 1월 1일')['date'] is None
    assert image_analysis.closing_choice('마감일 2026.11.01 또는 2026.11.02') is None


@pytest.mark.parametrize("fmt", ["PNG", "JPEG", "WEBP", "BMP", "GIF", "TIFF", "AVIF"])
def test_supported_formats_become_private_png_before_consented_analysis(fmt, monkeypatch):
    calls = mock_provider(monkeypatch, result())
    headers = auth()
    # Missing/nonstandard MIME must not block a valid bitmap; actual bytes decide.
    response = client.post("/api/sources/images", headers=headers,
        files={"file": ("notice." + fmt.lower(), picture(fmt), "application/octet-stream")})
    assert response.status_code == 201
    source = response.json()
    path = "/api/sources/" + source["id"]
    preview = client.get(path + "/image", headers=headers)
    assert preview.headers["content-type"] == "image/png"
    with Image.open(io.BytesIO(preview.content)) as decoded:
        assert decoded.format == "PNG" and decoded.size == (300, 180)
        assert decoded.mode == "RGB" and not decoded.getexif()
    assert calls == []
    started = client.post(path + "/ai-analyses", headers=headers, json={
        "input_hash":source["image_sha256"], "allow_external_ai":True})
    assert started.status_code == 202
    assert client.get("/api/ai-analyses/" + started.json()["id"], headers=headers).json()["status"] == "ready"
    assert len(calls) == 1


@pytest.mark.parametrize("fmt", ["GIF", "WEBP", "TIFF", "PNG"])
def test_animation_or_multiple_pages_are_rejected_without_source(fmt):
    frames = [Image.new("RGB", (8, 8), color) for color in ("black", "white")]
    raw = io.BytesIO()
    frames[0].save(raw, format=fmt, save_all=True, append_images=frames[1:])
    headers = auth()
    response = client.post("/api/sources/images", headers=headers,
        files={"file": ("animated." + fmt.lower(), raw.getvalue(), "image/" + fmt.lower())})
    assert response.status_code == 422 and "한 장" in response.json()["detail"]
    assert client.get("/api/sources", headers=headers).json() == []


def test_transparent_background_and_exif_orientation_preserve_readable_pixels():
    transparent = Image.new("RGBA", (8, 8), (0, 0, 0, 0))
    transparent.putpixel((4, 4), (0, 0, 0, 255))
    raw = io.BytesIO()
    transparent.save(raw, format="PNG", comment=b"must be removed")
    with Image.open(io.BytesIO(source_images.normalize_image(raw.getvalue()))) as decoded:
        assert decoded.getpixel((0, 0)) == (255, 255, 255)
        assert decoded.getpixel((4, 4)) == (0, 0, 0)
        assert not decoded.info
    raw = io.BytesIO()
    exif = Image.Exif()
    exif[274] = 6
    exif[270] = "private metadata"
    Image.new("RGB", (8, 4), "white").save(raw, format="JPEG", exif=exif)
    with Image.open(io.BytesIO(source_images.normalize_image(raw.getvalue()))) as decoded:
        assert decoded.size == (4, 8) and not decoded.getexif()
