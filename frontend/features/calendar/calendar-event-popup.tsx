"use client";
import { useScheduleTime } from "@/features/settings/time-zone";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useResource } from "@/lib/api/use-resource";
import { calendarColors, type CalendarColor } from "./calendar-colors";
import { canChangeTime, readCalendarDescription } from "./calendar-actions";
import type { TimetableEvent } from "./time-layout";
import "./calendar-event-popup.css";

type IconName = "edit" | "delete" | "copy" | "close" | "palette";
const paths: Record<IconName, string> = {
  edit: "m13 5 6 6M4 20l4.7-1L20 7.7 16.3 4 5 15.3 4 20Z",
  delete: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v6m4-6v6",
  copy: "M8 8h12v12H8zM16 4H4v12",
  close: "m6 6 12 12M18 6 6 18",
  palette:
    "M12 3a9 9 0 1 0 0 18c2 0 2.5-1.5 1.5-2.7-.9-1.1-.1-2.3 1.3-2.3H17a4 4 0 0 0 4-4c0-5-4-9-9-9ZM7.5 11h.01m3-4h.01m4 0h.01m3 4h.01",
};

function Icon({ name }: { name: IconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}

export type CalendarPopupSelection = {
  event: TimetableEvent;
  mode: "detail" | "menu";
  x: number;
  y: number;
};

export function CalendarEventPopup({
  selection,
  color,
  defaultColor,
  busy,
  error,
  onClose,
  onColor,
  onDefaultColor,
  onDelete,
  onDuplicate,
  onMove,
}: {
  selection: CalendarPopupSelection;
  color?: string;
  defaultColor: { id?: CalendarColor; label: string; value: string };
  busy: boolean;
  error: string;
  onClose: () => void;
  onColor: (color: CalendarColor | null) => void;
  onDefaultColor: (color: CalendarColor | null) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMove: (start: string, end: string) => void;
}) {
  const { toLocalInput, formatLocal, fromLocalInput, zoneLabel } =
    useScheduleTime();
  const { event, mode, x, y } = selection;
  const target = event.target;
  const title = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [panel, setPanel] = useState<"main" | "delete" | "time">("main");
  const [palette, showPalette] = useState(mode === "menu");
  const [editingDefault, setEditingDefault] = useState(false);
  const defaultPaletteId = useId();
  const [start, setStart] = useState(() =>
    event.start ? toLocalInput(event.start) : "",
  );
  const [end, setEnd] = useState(() =>
    event.end ? toLocalInput(event.end) : "",
  );
  const [timeError, setTimeError] = useState("");
  const description = useResource(
    useCallback(
      () =>
        target && mode === "detail"
          ? readCalendarDescription(target)
          : Promise.resolve(null),
      [target, mode],
    ),
  );
  const canRemove = Boolean(
    target && (target.kind !== "placement" || !target.locked),
  );
  const canEdit = canChangeTime(event);
  const editHref =
    target?.kind === "task" && target.occurrence
      ? `/tasks/${encodeURIComponent(target.id)}?${new URLSearchParams({ occurrence: target.occurrence, edit: "1" })}`
      : event.href &&
        `${event.href}${event.href.includes("?") ? "&" : "?"}edit=1`;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    const position = () => {
      const bounds = element.getBoundingClientRect();
      element.style.left = `${Math.max(12, Math.min(x, window.innerWidth - bounds.width - 12))}px`;
      element.style.top = `${Math.max(12, Math.min(y, window.innerHeight - bounds.height - 12))}px`;
    };
    position();
    const resize = new ResizeObserver(position);
    resize.observe(element);
    window.addEventListener("resize", position);
    return () => {
      resize.disconnect();
      window.removeEventListener("resize", position);
      element.close();
    };
  }, [x, y]);

  return (
    <dialog
      className={`calendar-popup is-${mode}`}
      ref={dialog}
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(click) => {
        if (click.target !== click.currentTarget || busy) return;
        const r = click.currentTarget.getBoundingClientRect();
        if (
          click.clientX < r.left ||
          click.clientX > r.right ||
          click.clientY < r.top ||
          click.clientY > r.bottom
        )
          onClose();
      }}
    >
      <header className="calendar-popup-header">
        <h3 id={title}>{event.title}</h3>
        <button
          type="button"
          className="calendar-icon"
          aria-label="닫기"
          disabled={busy}
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </header>
      {mode === "detail" && (
        <>
          <p className="small muted">
            {event.start
              ? formatLocal(event.start)
              : `${event.startDate ?? ""} · 종일`}
            {event.end && ` → ${formatLocal(event.end)}`}
          </p>
          <p className="small muted">
            {!target
              ? "Google 캘린더"
              : event.kind === "deadline"
                ? "마감일"
                : target.kind === "placement"
                  ? "캘린더에 배치한 할 일"
                  : "할 일"}
          </p>
          {description.data && (
            <p className="calendar-popup-note">{description.data}</p>
          )}
          {description.error && (
            <p className="small muted">메모를 불러오지 못했습니다.</p>
          )}
          {target?.kind === "placement" && event.href && (
            <Link className="small" href={event.href}>
              할 일 상세 보기 →
            </Link>
          )}
          {!canEdit && target?.kind === "placement" && target.locked && (
            <p className="small muted">
              이 배치는 연결된 캘린더에서 관리합니다.
            </p>
          )}
        </>
      )}
      {panel === "main" && target && (
        <div className="calendar-popup-actions">
          {mode === "detail" &&
            canEdit &&
            (target.kind === "placement" ? (
              <button
                type="button"
                className="calendar-icon"
                title="수정"
                aria-label="수정"
                onClick={() => setPanel("time")}
              >
                <Icon name="edit" />
              </button>
            ) : (
              editHref && (
                <Link
                  className="calendar-icon"
                  href={editHref}
                  title="수정"
                  aria-label="수정"
                >
                  <Icon name="edit" />
                </Link>
              )
            ))}
          {canRemove && (
            <button
              className="calendar-icon"
              type="button"
              title="삭제"
              aria-label="삭제"
              disabled={busy}
              onClick={() => setPanel("delete")}
            >
              <Icon name="delete" />
              {mode === "menu" && <span>삭제</span>}
            </button>
          )}
          {mode === "detail" && (
            <>
              <button
                className="calendar-icon"
                type="button"
                title="복제"
                aria-label="복제"
                disabled={busy || !event.start}
                onClick={onDuplicate}
              >
                <Icon name="copy" />
              </button>
              <button
                className="calendar-icon"
                type="button"
                title="색상 변경"
                aria-label="색상 변경"
                aria-expanded={palette}
                disabled={busy}
                onClick={() => showPalette(!palette)}
              >
                <Icon name="palette" />
              </button>
            </>
          )}
        </div>
      )}
      {palette && target && panel === "main" && (
        <div
          className="calendar-popup-colors"
          role="group"
          aria-label="일정 색상"
        >
          {!editingDefault &&
            calendarColors.map(({ id, label, value }) => (
              <button
                key={id}
                type="button"
                className="calendar-color-option"
                aria-label={label}
                title={label}
                aria-pressed={color === id}
                style={{ backgroundColor: value }}
                disabled={busy}
                onClick={() => onColor(id)}
              >
                {color === id ? "✓" : ""}
              </button>
            ))}
          <div className="calendar-default-color-row">
            <button
              type="button"
              className="secondary calendar-color-default"
              aria-pressed={!color}
              disabled={busy}
              onClick={() => onColor(null)}
            >
              기본 색상
            </button>
            <span
              className="calendar-default-color-current"
              aria-label={`현재 기본 색상: ${defaultColor.label}`}
            >
              <span
                aria-hidden="true"
                style={{ backgroundColor: defaultColor.value }}
              />
              {defaultColor.label}
            </span>
            <button
              className="calendar-icon"
              type="button"
              aria-label="기본 색상 수정"
              title="기본 색상 수정"
              aria-expanded={editingDefault}
              aria-controls={editingDefault ? defaultPaletteId : undefined}
              disabled={busy}
              onClick={() => setEditingDefault(!editingDefault)}
            >
              <Icon name="edit" />
            </button>
          </div>
          {editingDefault && (
            <div
              className="calendar-default-palette"
              id={defaultPaletteId}
              role="group"
              aria-label={`${event.kind === "deadline" ? "마감일" : "할 일"} 기본 색상`}
            >
              {calendarColors.map(({ id, label, value }) => (
                <button
                  key={id}
                  type="button"
                  className="calendar-color-option"
                  aria-label={label}
                  title={label}
                  aria-pressed={defaultColor.id === id}
                  style={{ backgroundColor: value }}
                  disabled={busy}
                  onClick={() => onDefaultColor(id)}
                >
                  {defaultColor.id === id ? "✓" : ""}
                </button>
              ))}
              <button
                type="button"
                className="secondary calendar-color-default"
                aria-pressed={!defaultColor.id}
                disabled={busy}
                onClick={() => onDefaultColor(null)}
              >
                처음 색상으로 복원
              </button>
            </div>
          )}
        </div>
      )}
      {panel === "delete" && (
        <div
          className="calendar-popup-confirm"
          role="group"
          aria-label="일정 삭제 확인"
        >
          <p>
            {target?.kind === "placement"
              ? "선택한 배치 구간을 삭제할까요? 할 일은 유지됩니다."
              : target?.kind === "task" && target.occurrence
                ? "이번 회차만 삭제할까요?"
                : target?.kind === "deadline"
                  ? "마감일을 삭제할까요? 마지막으로 연결된 원본 자료도 함께 삭제될 수 있습니다."
                  : "이 할 일을 삭제할까요?"}
          </p>
          <div className="form-actions">
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={() => setPanel("main")}
            >
              취소
            </button>
            <button
              className="danger"
              type="button"
              disabled={busy}
              onClick={onDelete}
            >
              삭제 확인
            </button>
          </div>
        </div>
      )}
      {panel === "time" && (
        <form
          className="calendar-popup-confirm"
          onSubmit={(submit) => {
            submit.preventDefault();
            try {
              const first = fromLocalInput(start);
              const last = fromLocalInput(end);
              if (Date.parse(first) >= Date.parse(last))
                throw new Error("종료 시간은 시작 시간보다 늦어야 합니다.");
              setTimeError("");
              onMove(first, last);
            } catch {
              setTimeError("시작 시간과 종료 시간을 확인해 주세요.");
            }
          }}
        >
          <label>
            시작 시간 ({zoneLabel})
            <input
              type="datetime-local"
              required
              value={start}
              onChange={(e) => setStart(e.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            종료 시간 ({zoneLabel})
            <input
              type="datetime-local"
              required
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              disabled={busy}
            />
          </label>
          {timeError && <p role="alert">{timeError}</p>}
          <div className="form-actions">
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={() => setPanel("main")}
            >
              취소
            </button>
            <button disabled={busy}>시간 저장</button>
          </div>
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {busy && (
        <p className="small muted" role="status">
          일정을 저장하고 있습니다.
        </p>
      )}
    </dialog>
  );
}
