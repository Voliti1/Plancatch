"use client";
import { useRef, useState, type DragEvent } from "react";

export function SourceFileInput({
  files,
  onChange,
  disabled,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled: boolean;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  function choose(incoming: File[]) {
    if (disabled) return;
    setDragging(false);
    if (incoming.length !== 1) {
      setError("이미지 한 장씩 등록해 주세요.");
      return;
    }
    const file = incoming[0];
    // Browsers can report PNG as image/x-png or application/octet-stream.
    // The server decodes the actual bytes; MIME is not a reliable format check here.
    if (!/\.(png|jpe?g|webp|bmp|gif|tiff?|avif)$/i.test(file.name)) {
      setError(
        "PNG·JPG·WebP·BMP·GIF·TIFF·AVIF를 지원합니다. HEIC·SVG·PDF는 아직 지원하지 않습니다.",
      );
      return;
    }
    if (!file.size || file.size > 5 * 1024 * 1024) {
      setError("이미지는 5MB 이하여야 합니다.");
      return;
    }
    setError("");
    onChange([file]);
  }
  function drop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    choose(Array.from(event.dataTransfer.files));
  }
  return (
    <section
      className="source-file-input"
      aria-labelledby="source-file-heading"
    >
      <div className="source-file-heading">
        <h3 id="source-file-heading">파일로 추가</h3>
        <span className="tag">이미지 지원</span>
      </div>
      <button
        type="button"
        className={`source-file-drop${dragging ? " is-dragging" : ""}`}
        disabled={disabled}
        aria-label="이미지 파일 선택"
        aria-describedby="source-file-help"
        onClick={() => picker.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = disabled ? "none" : "copy";
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
      >
        <span className="source-file-symbol" aria-hidden="true">
          PNG<span>JPG</span>
        </span>
        <strong>이미지를 여기에 끌어다 놓으세요</strong>
        <span className="source-file-hint">
          스크린샷이나 촬영한 공지 이미지를 선택하세요.
        </span>
        <span className="source-file-picker">또는 파일 선택</span>
        <span className="source-file-hint">
          PNG · JPG · WebP 등 · 한 장 · 최대 5MB
        </span>
      </button>
      <input
        ref={picker}
        type="file"
        accept=".png,.jpg,.jpeg,.webp,.bmp,.gif,.tif,.tiff,.avif,image/png,image/x-png,image/jpeg,image/webp,image/bmp,image/gif,image/tiff,image/avif"
        hidden
        disabled={disabled}
        aria-label="이미지 파일 입력"
        onChange={(event) => {
          choose(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      <p id="source-file-help" className="small muted source-file-help">
        PNG·JPG·WebP·BMP·GIF·TIFF·AVIF를 지원하며 PNG로 변환해 저장합니다.
        움직이는 이미지·여러 페이지·HEIC·SVG·PDF는 지원하지 않습니다. 이미지를
        저장한 뒤 전송 동의를 받습니다. 동의 전에는 Google Gemini로 보내지
        않습니다.
      </p>
      <p role="status" className="small muted">
        {files.length
          ? "이미지 1장 선택 · 아직 업로드하지 않았습니다."
          : "선택한 파일이 없습니다."}
      </p>
      {error && (
        <p className="source-file-error" role="alert">
          {error}
        </p>
      )}
      {!!files.length && (
        <ul className="source-file-list" aria-label="선택한 파일">
          {files.map((file) => (
            <li key={file.name}>
              <span className="source-file-kind">이미지</span>
              <span className="source-file-name">
                {file.name}
                <small>{(file.size / 1024).toFixed(1)} KB · 미업로드</small>
              </span>
              <button
                type="button"
                className="secondary source-file-remove"
                disabled={disabled}
                aria-label={`${file.name} 제거`}
                onClick={() => onChange([])}
              >
                제거
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
