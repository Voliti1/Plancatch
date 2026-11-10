"use client";
import { useId, useRef, useState } from "react";
import { DeletionSync } from "./deletion-sync";

export function DeletionSyncDialog({
  refreshKey,
  disabled,
}: {
  refreshKey: number;
  disabled: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const outsidePress = useRef(false);
  const titleId = useId();
  const [open, setOpen] = useState(false);
  function outside(
    event:
      | React.MouseEvent<HTMLDialogElement>
      | React.PointerEvent<HTMLDialogElement>,
  ) {
    const box = event.currentTarget.getBoundingClientRect();
    return (
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom
    );
  }
  return (
    <div className="google-deletion-footer">
      <button
        type="button"
        className="secondary"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          const modal = dialog.current;
          if (!modal) return;
          modal.dataset.reserveGutter = String(
            window.innerWidth > document.documentElement.clientWidth,
          );
          setOpen(true);
          modal.showModal();
        }}
      >
        Google 캘린더 삭제 상태 보기
      </button>
      <dialog
        ref={dialog}
        className="google-deletion-dialog"
        aria-labelledby={titleId}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const stops = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
            ),
          ).filter((element) => element.getClientRects().length > 0);
          const first = stops[0],
            last = stops.at(-1);
          if (
            first &&
            last &&
            event.shiftKey &&
            document.activeElement === first
          ) {
            event.preventDefault();
            last.focus();
          } else if (
            first &&
            last &&
            !event.shiftKey &&
            document.activeElement === last
          ) {
            event.preventDefault();
            first.focus();
          }
        }}
        onClose={() => setOpen(Boolean(dialog.current?.open))}
        onPointerDown={(e) => {
          outsidePress.current = outside(e);
        }}
        onClick={(e) => {
          if (outsidePress.current && outside(e)) dialog.current?.close();
        }}
      >
        <header className="google-deletion-dialog-header">
          <h2 id={titleId}>Google 캘린더 삭제 상태</h2>
          <button
            type="button"
            className="secondary source-dialog-close"
            aria-label="삭제 상태 창 닫기"
            onClick={() => dialog.current?.close()}
          >
            ×
          </button>
        </header>
        <div className="google-deletion-dialog-body">
          {open && <DeletionSync refreshKey={refreshKey} disabled={disabled} />}
        </div>
      </dialog>
    </div>
  );
}
