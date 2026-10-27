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
    assert not source_images.image_path(key).exists()


@pytest.mark.parametrize("data", [b"not an image",b"<svg onload='alert(1)'/>", b"%PDF-1.4"])
def test_invalid_uploads_do_not_create_source_or_send_ai(data):
    headers = auth()
    assert client.post("/api/sources/images",headers=headers,files={"file":("fake.png",data,"image/png")}).status_code == 422
    assert client.get("/api/sources",headers=headers).json() == []


def test_limits_and_integrity_are_enforced(monkeypatch):
    with pytest.raises(ValueError): source_images.normalize_image(b"x"*(source_images.MAX_BYTES+1))
    monkeypatch.setattr(source_images,"MAX_PIXELS",10)
    with pytest.raises(ValueError): source_images.normalize_image(picture())
    monkeypatch.setattr(source_images,"MAX_PIXELS",12_000_000)
    headers = auth()
    source = upload(headers,picture("JPEG"))
    path = source_images.image_path(source["storage_key"])
    path.write_bytes(b"changed")
    assert client.get('/api/sources/'+source['id']+'/image',headers=headers).status_code == 404
    with pytest.raises(ValueError): source_images.image_path("../../.env")


def test_bad_evidence_fails_safely_and_explicit_time_is_grounded(monkeypatch):
    value = result()
    value["deadlines"][0]["evidence_text"] = "not in image transcript"
    mock_provider(monkeypatch,value)
    with pytest.raises(ai_analysis.AIError,match="ai_evidence_not_in_source"):
        image_analysis.analyze_image(picture(),"test-model")
    value = result("2026-11-01T18:00:00+09:00")
    value["transcript"] = value["deadlines"][0]["evidence_text"] = "접수 마감 2026년 11월 1일 18:00"
    mock_provider(monkeypatch,value)
    assert image_analysis.analyze_image(picture(),"test-model").deadlines[0].due_at.hour == 18


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
    parsed = image_analysis.analyze_image(picture(), "test-model")
    assert parsed.deadlines[0].due_at.isoformat() == "2026-10-27T17:00:00+09:00"
    assert not any("due_at" in item or "null" in item for item in parsed.warnings)
    assert not any("11시 59분" in item for item in parsed.warnings)


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
