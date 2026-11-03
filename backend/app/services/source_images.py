"""Normalize images and keep immutable image/PDF files in private storage."""
import hashlib
import io
import re
import uuid
from pathlib import Path

from PIL import Image, ImageOps

MAX_BYTES = 5 * 1024 * 1024
MAX_PIXELS = 12_000_000
ROOT = Path(__file__).resolve().parents[2] / "private_uploads"
FILE_EXTENSIONS = {"image": "png", "pdf": "pdf"}
KEY = re.compile(r"[a-f0-9]{32}-([a-f0-9]{64})\.(png|pdf)")
FORMATS = ["PNG", "JPEG", "WEBP", "BMP", "GIF", "TIFF", "AVIF"]
FORMAT_LABEL = "PNG·JPG·WebP·BMP·GIF·TIFF·AVIF"


def normalize_image(data: bytes) -> bytes:
    if not data or len(data) > MAX_BYTES:
        raise ValueError(f"이미지는 5MB 이하의 {FORMAT_LABEL} 파일이어야 합니다.")
    try:
        # Detect actual bytes, not browser MIME/filename. Keep the decoder allowlist bounded.
        with Image.open(io.BytesIO(data), formats=FORMATS) as image:
            if image.width * image.height > MAX_PIXELS:
                raise ValueError("이미지는 1,200만 화소 이하여야 합니다.")
            if getattr(image, "n_frames", 1) != 1:
                raise ValueError("움직이는 이미지나 여러 페이지 이미지는 지원하지 않습니다. 한 장으로 저장해 주세요.")
            image.load()
            # Re-encode only pixels: drop filenames, EXIF/location, comments and active content.
            oriented = ImageOps.exif_transpose(image)
            # White preserves dark screenshot text on transparent PNG/GIF/WebP backgrounds.
            if "A" in oriented.getbands() or "transparency" in oriented.info:
                rgba = oriented.convert("RGBA")
                pixels = Image.new("RGB", rgba.size, "white")
                pixels.paste(rgba, mask=rgba.getchannel("A"))
            else:
                # Most screenshots/photos are opaque: avoid an RGBA copy and mask.
                pixels = oriented.convert("RGB")
            pixels.info.clear()
            output = io.BytesIO()
            pixels.save(output, format="PNG")
            result = output.getvalue()
            if len(result) > MAX_BYTES:
                raise ValueError("이미지 용량이 큽니다. 필요한 부분만 잘라서 다시 올려 주세요.")
            return result
    except (OSError, EOFError, SyntaxError, Image.DecompressionBombError) as exc:
        raise ValueError(f"읽을 수 없는 이미지입니다. {FORMAT_LABEL} 파일을 확인해 주세요.") from exc


def file_hash(key: str | None, source_type: str) -> str | None:
    match = KEY.fullmatch(key or "")
    return match[1] if match and match[2] == FILE_EXTENSIONS.get(source_type) else None


def file_path(key: str) -> Path:
    if not KEY.fullmatch(key):
        raise ValueError("Invalid image key")
    root = ROOT.resolve()
    path = root / key
    if path.is_symlink() or path.resolve().parent != root:
        raise ValueError("Invalid image path")
    return path


def store_file(data: bytes, source_type: str) -> str:
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    key = f"{uuid.uuid4().hex}-{hashlib.sha256(data).hexdigest()}.{FILE_EXTENSIONS[source_type]}"
    path = file_path(key)
    with path.open("xb") as output:
        path.chmod(0o600)
        output.write(data)
    return key


def read_file(key: str, source_type: str) -> bytes:
    with file_path(key).open("rb") as uploaded:
        data = uploaded.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES or hashlib.sha256(data).hexdigest() != file_hash(key, source_type):
        raise ValueError("File snapshot changed")
    return data


def remove_file(key: str | None) -> None:
    if key:
        file_path(key).unlink(missing_ok=True)


def validate_pdf(data: bytes) -> bytes:
    if len(data) > MAX_BYTES:
        raise ValueError("PDF는 5MB 이하여야 합니다.")
    # Check the file envelope here. Document decoding happens only after consent.
    if not re.match(rb"%PDF-(?:1\.[0-7]|2\.0)[\r\n]", data) or not data.rstrip().endswith(b"%%EOF"):
        raise ValueError("읽을 수 없는 PDF입니다. 파일을 확인해 주세요.")
    return data
