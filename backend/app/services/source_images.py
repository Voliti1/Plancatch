"""Private immutable PNG snapshots, never served as public/static files."""
import hashlib
import io
import re
import uuid
from pathlib import Path

from PIL import Image, ImageOps

MAX_BYTES = 5 * 1024 * 1024
MAX_PIXELS = 12_000_000
ROOT = Path(__file__).resolve().parents[2] / "private_uploads"
KEY = re.compile(r"[a-f0-9]{32}-([a-f0-9]{64})\.png")
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
            rgba = oriented.convert("RGBA")
            pixels = Image.new("RGB", rgba.size, "white")
            pixels.paste(rgba, mask=rgba.getchannel("A"))
            pixels.info.clear()
            output = io.BytesIO()
            pixels.save(output, format="PNG")
            result = output.getvalue()
            if len(result) > MAX_BYTES:
                raise ValueError("이미지 용량이 큽니다. 필요한 부분만 잘라서 다시 올려 주세요.")
            return result
    except (OSError, EOFError, SyntaxError, Image.DecompressionBombError) as exc:
        raise ValueError(f"읽을 수 없는 이미지입니다. {FORMAT_LABEL} 파일을 확인해 주세요.") from exc


def image_hash(key: str | None) -> str | None:
    match = KEY.fullmatch(key or "")
    return match[1] if match else None


def image_path(key: str) -> Path:
    if not KEY.fullmatch(key):
        raise ValueError("Invalid image key")
    root = ROOT.resolve()
    path = root / key
    if path.is_symlink() or path.resolve().parent != root:
        raise ValueError("Invalid image path")
    return path


def store_image(data: bytes) -> str:
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    key = uuid.uuid4().hex + "-" + hashlib.sha256(data).hexdigest() + ".png"
    path = image_path(key)
    with path.open("xb") as output:
        path.chmod(0o600)
        output.write(data)
    return key


def read_image(key: str) -> bytes:
    with image_path(key).open("rb") as image:
        data = image.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES or hashlib.sha256(data).hexdigest() != image_hash(key):
        raise ValueError("Image snapshot changed")
    return data


def remove_image(key: str | None) -> None:
    if key:
        image_path(key).unlink(missing_ok=True)
