"use client";
import { useId, useRef, useState } from "react";
import { ErrorNotice } from "@/components/feedback";
import { errorMessage } from "@/lib/api/client";
import { useHydrated } from "@/lib/use-hydrated";
import { seoulInputToUtc, toSeoulInput } from "@/lib/date/seoul";
import type { Task } from "@/types/task";
import type {
  EditableEventStatus,
  ScheduledEvent,
  ScheduledEventUpdate,
} from "@/types/scheduled-event";

export function EventForm({
  task,
  initial,
  blocked,
  onSave,
  onCancel,
}: {
  task: Task;
  initial?: ScheduledEvent;
  blocked: boolean;
  onSave: (input: Required<ScheduledEventUpdate>) => Promise<void>;
  onCancel: () => void;
}) {
  const id = useId();
  const hydrated = useHydrated();
  const [start, setStart] = useState(
    (initial?.start_at ?? task.earliest_start)
      ? toSeoulInput((initial?.start_at ?? task.earliest_start)!)
      : "",
  );
  const [end, setEnd] = useState(
    (initial?.end_at ?? task.latest_end)
      ? toSeoulInput((initial?.end_at ?? task.latest_end)!)
      : "",
  );
  const [status, setStatus] = useState<EditableEventStatus>(
    initial && initial.status !== "synced" ? initial.status : "approved",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || blocked || !hydrated) return;
    setError("");
    if (!start || !end) {
      setError("배치 시작과 배치 종료를 입력해 주세요.");
      return;
    }
    const start_at =
      initial && start === toSeoulInput(initial.start_at)
        ? initial.start_at
        : seoulInputToUtc(start);
    const end_at =
      initial && end === toSeoulInput(initial.end_at)
        ? initial.end_at
        : seoulInputToUtc(end);
    if (Date.parse(start_at) >= Date.parse(end_at)) {
      setError("배치 종료는 시작보다 늦어야 합니다.");
      return;
    }
    pending.current = true;
    setBusy(true);
    try {
      await onSave({ start_at, end_at, status });
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <form className="event-form" onSubmit={submit} noValidate>
      <h3>{initial ? "배치 시간 수정" : "캘린더에 배치"}</h3>
      <fieldset disabled={busy || !hydrated}>
        <div className="form-grid">
          <label htmlFor={`${id}-start`}>
            배치 시작
            <input
              id={`${id}-start`}
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              required
            />
          </label>
          <label htmlFor={`${id}-end`}>
            배치 종료
            <input
              id={`${id}-end`}
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              required
            />
          </label>
        </div>
        {initial && (
          <label htmlFor={`${id}-status`}>
            배치 상태
            <select
              id={`${id}-status`}
              value={status}
              onChange={(e) => setStatus(e.target.value as EditableEventStatus)}
            >
              <option value="approved">확정</option>
              <option value="recommended">제안</option>
              <option value="cancelled">취소</option>
            </select>
          </label>
        )}
        <p className="small muted">
          한국 시간 기준입니다. 일정의 가능 기간은 바꾸지 않습니다. 시간
          겹침이나 마감일 충돌은 자동으로 검사하지 않습니다.
        </p>
        {error && <ErrorNotice message={error} />}
        <div className="form-actions">
          <button className="secondary" type="button" onClick={onCancel}>
            닫기
          </button>
          <button type="submit" disabled={blocked}>
            {busy ? "저장 중…" : initial ? "배치 변경 저장" : "캘린더에 배치"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
