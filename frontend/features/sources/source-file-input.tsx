"use client";
import { useRef, useState } from "react";
import type { DragEvent } from "react";

function supportedFile(file: File) {
  if (/\.pdf$/i.test(file.name))
    return !file.type || file.type === "application/pdf";
  return (
    /\.jpe?g$/i.test(file.name) && (!file.type || file.type === "image/jpeg")
  );
}

function fileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Files stay in component memory until an upload API is available.
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
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");

  function addFiles(incoming: File[]) {
    if (disabled) return;
    const accepted = [...files];
    const rejected: string[] = [];
    for (const file of incoming) {
      if (!supportedFile(file)) {
        rejected.push(file.name);
        continue;
      }
      if (!accepted.some((item) => fileKey(item) === fileKey(file)))
        accepted.push(file);
    }
    setError(
      rejected.length
        ? `PDF 또는 JPG 파일만 선택할 수 있어요: ${rejected.join(", ")}`
        : "",
    );
    onChange(accepted);
  }

  function drop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  }

  return (
    <section
      className="source-file-input"
      aria-labelledby="source-file-heading"
    >
      <div className="source-file-heading">
        <h3 id="source-file-heading">파일로 추가</h3>
        <span className="tag">업로드 준비 중</span>
      </div>
      <button
        type="button"
        className={`source-file-drop${dragging ? " is-dragging" : ""}`}
        disabled={disabled}
        aria-label="PDF·JPG 파일 선택"
        aria-describedby="source-file-help"
        onClick={() => picker.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault();
          if (
            disabled ||
            !Array.from(event.dataTransfer.types).includes("Files")
          )
            return;
          dragDepth.current++;
          setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = disabled ? "none" : "copy";
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (!dragDepth.current) setDragging(false);
        }}
        onDrop={drop}
      >
        <span className="source-file-symbol" aria-hidden="true">
          PDF<span>JPG</span>
        </span>
        <strong>파일을 여기에 끌어다 놓으세요</strong>
        <span className="source-file-hint">
          공지 PDF나 JPG 이미지를 선택하세요.
        </span>
        <span className="source-file-picker">또는 파일 선택</span>
        <span className="source-file-hint">PDF · JPG · JPEG</span>
      </button>
      <input
        ref={picker}
        type="file"
        accept=".pdf,.jpg,.jpeg,application/pdf,image/jpeg"
        multiple
        hidden
        disabled={disabled}
        aria-label="PDF·JPG 파일 입력"
        onChange={(event) => {
          addFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      <p id="source-file-help" className="small muted source-file-help">
        파일 선택만 미리 볼 수 있으며 서버에 업로드되거나 분석되지 않습니다.
        파일의 내용을 텍스트로 붙여 넣어 등록할 수 있어요.
      </p>
      <p role="status" className="small muted">
        {files.length
          ? `${files.length}개 파일 선택 · 이 화면에서만 유지됩니다.`
          : "선택한 파일이 없습니다."}
      </p>
      {error && (
        <p className="source-file-error" role="alert">
          {error}
        </p>
      )}
      {files.length > 0 && (
        <>
          <ul className="source-file-list" aria-label="선택한 파일">
            {files.map((file) => (
              <li key={fileKey(file)}>
                <span className="source-file-kind">
                  {/\.pdf$/i.test(file.name) ? "PDF" : "JPG"}
                </span>
                <span className="source-file-name">
                  {file.name}
                  <small>{formatSize(file.size)} · 미업로드</small>
                </span>
                <button
                  type="button"
                  className="secondary source-file-remove"
                  disabled={disabled}
                  aria-label={`${file.name} 제거`}
                  onClick={() =>
                    onChange(
                      files.filter((item) => fileKey(item) !== fileKey(file)),
                    )
                  }
                >
                  제거
                </button>
              </li>
            ))}
          </ul>
          <p className="notice subtle small" role="status">
            파일 업로드는 아직 지원하지 않습니다. URL 또는 텍스트를 저장하려면
            선택한 파일을 먼저 제거해 주세요.
          </p>
        </>
      )}
    </section>
  );
}
