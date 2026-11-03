"""Extract the text layer of an uploaded PDF in a bounded child process."""
import io
import json
import sys

from pypdf import PdfReader

MAX_PAGES = 100
MAX_TEXT = 160_000


def extract(data: bytes) -> list[str]:
    reader = PdfReader(io.BytesIO(data))
    if reader.is_encrypted or len(reader.pages) > MAX_PAGES:
        raise ValueError("Encrypted or oversized PDF")
    pages = []
    remaining = MAX_TEXT
    for page in reader.pages:
        value = page.extract_text(extraction_mode="layout", layout_mode_space_vertically=False)
        if len(value) > remaining:
            raise ValueError("PDF text limit exceeded")
        pages.append(value)
        remaining -= len(value)
    return pages


if __name__ == "__main__":
    if sys.platform == "linux":
        import resource

        resource.setrlimit(resource.RLIMIT_AS, (384 * 1024 * 1024,) * 2)
        resource.setrlimit(resource.RLIMIT_CPU, (12, 13))
    sys.stdout.write(json.dumps(extract(sys.stdin.buffer.read())))
