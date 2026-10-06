"use client";
import { useId, useRef } from "react";
import { extractedSummary } from "./extracted-summary";

export function SourceExtractedContent({ text }: { text: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const outsidePress = useRef(false);
  const titleId = useId();
  const summary = extractedSummary(text);
  function outside(event: React.MouseEvent | React.PointerEvent) {
    const rect = event.currentTarget.getBoundingClientRect();
    return (
      event.target === event.currentTarget &&
      (event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom)
    );
  }
  return (
    <section
      className="source-content source-extracted-content"
      aria-label="추출된 내용"
    >
      <h3>추출된 내용</h3>
      {text.trim() ? (
        <>
          <dl className="extracted-summary">
            <div>
              <dt>회사명</dt>
              <dd>{summary.company}</dd>
            </div>
            <div>
              <dt>마감일</dt>
              <dd>{summary.deadline}</dd>
            </div>
          </dl>
          <p className="muted small">
            원문 표시값입니다. 확정된 마감일은 마감일 페이지에서 확인하세요.
          </p>
          <button
            type="button"
            className="secondary"
            aria-haspopup="dialog"
            onClick={() => {
              const modal = dialog.current;
              if (!modal) return;
              // Preserve an existing scrollbar gap, but never introduce one
              // on overlay-scrollbar/mobile/narrow layouts.
              modal.dataset.reserveGutter = String(
                window.innerWidth > document.documentElement.clientWidth,
              );
              modal.showModal();
            }}
          >
            자세히 보기
          </button>
          <dialog
            ref={dialog}
            className="source-content-dialog"
            aria-labelledby={titleId}
            onKeyDown={(event) => {
              if (event.key !== "Tab") return;
              const stops = event.currentTarget.querySelectorAll<HTMLElement>(
                'button, [tabindex="0"]',
              );
              const first = stops[0];
              const last = stops[stops.length - 1];
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
              }
            }}
            onPointerDown={(event) => {
              outsidePress.current = outside(event);
            }}
            onClick={(event) => {
              if (outsidePress.current && outside(event))
                dialog.current?.close();
            }}
          >
            <div className="source-dialog-header">
              <h2 id={titleId}>추출된 내용 자세히 보기</h2>
              <button
                type="button"
                className="secondary source-dialog-close"
                aria-label="자세히 보기 닫기"
                onClick={() => dialog.current?.close()}
              >
                ×
              </button>
            </div>
            <div
              className="source-dialog-body"
              tabIndex={0}
              aria-label="전체 추출 내용"
            >
              <p className="source-text">{text}</p>
            </div>
          </dialog>
        </>
      ) : (
        <p className="muted">추출된 내용이 없습니다.</p>
      )}
    </section>
  );
}
