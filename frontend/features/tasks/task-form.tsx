"use client";
import { useId, useRef, useState } from "react";
import { ErrorNotice, Loading } from "@/components/feedback";
import { errorMessage } from "@/lib/api/client";
import { useResource } from "@/lib/api/use-resource";
import { seoulInputToUtc, toSeoulInput } from "@/lib/date/seoul";
import { useHydrated } from "@/lib/use-hydrated";
import type { ScheduleType, Task, TaskInput } from "@/types/task";
import { loadDeadlineOptions } from "./deadline-options";

function optionalUtc(value: string, original: string | null): string | null {
  if (!value) return null;
  // Preserve server seconds/milliseconds when only another field is edited.
  return original && value === toSeoulInput(original)
    ? original
    : seoulInputToUtc(value);
}

export function TaskForm({
  initial,
  deadlineId,
  onSave,
  onCancel,
}: {
  initial?: Task;
  deadlineId?: string;
  onSave: (payload: TaskInput) => Promise<void>;
  onCancel: () => void;
}) {
  const hydrated = useHydrated();
  const descriptionId = useId();
  const deadlineLabelId = useId();
  const priorityLabelId = useId();
  const typeLabelId = useId();
  const options = useResource(loadDeadlineOptions);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [deadline, setDeadline] = useState(
    initial?.deadline_id ?? deadlineId ?? "",
  );
  const [minutes, setMinutes] = useState(
    initial?.estimated_minutes?.toString() ?? "",
  );
  const [priority, setPriority] = useState(initial?.priority ?? 3);
  const [scheduleType, setScheduleType] = useState<ScheduleType>(
    initial?.schedule_type ?? "flexible",
  );
  const [start, setStart] = useState(
    initial?.earliest_start ? toSeoulInput(initial.earliest_start) : "",
  );
  const [end, setEnd] = useState(
    initial?.latest_end ? toSeoulInput(initial.latest_end) : "",
  );
  const [completed, setCompleted] = useState(initial?.is_completed ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      if (!title.trim()) throw new Error("작업명을 입력해 주세요.");
      const estimated = minutes === "" ? null : Number(minutes);
      if (
        estimated !== null &&
        (!Number.isInteger(estimated) ||
          estimated <= 0 ||
          estimated > 2147483647)
      )
        throw new Error("예상 소요시간은 1분 이상의 정수로 입력해 주세요.");
      if (deadline && !options.data?.some((item) => item.id === deadline))
        throw new Error(
          "연결할 마감일을 다시 선택하거나 연결 안 함을 선택해 주세요.",
        );
      const earliest = optionalUtc(start, initial?.earliest_start ?? null);
      const latest = optionalUtc(end, initial?.latest_end ?? null);
      if (earliest && latest && new Date(earliest) >= new Date(latest))
        throw new Error("최종 완료 일시는 가능 시작 일시보다 늦어야 합니다.");
      await onSave({
        title: title.trim(),
        deadline_id: deadline || null,
        description: description.trim() || null,
        estimated_minutes: estimated,
        priority,
        schedule_type: scheduleType,
        earliest_start: earliest,
        latest_end: latest,
        is_completed: completed,
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {options.loading && <Loading />}
      {options.error && (
        <ErrorNotice
          message={`마감일 목록을 불러오지 못했습니다. ${options.error}`}
          retry={options.reload}
        />
      )}
      <fieldset
        disabled={
          busy || !hydrated || options.loading || Boolean(options.error)
        }
      >
        <label>
          작업명
          <input
            name="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            maxLength={255}
            placeholder="예: 발표 자료 초안 작성"
          />
        </label>
        <label>
          <span id={deadlineLabelId}>연결할 마감일</span>
          <select
            name="deadline_id"
            aria-labelledby={deadlineLabelId}
            value={deadline}
            onChange={(event) => setDeadline(event.target.value)}
          >
            <option value="">연결 안 함</option>
            {deadline &&
              !options.data?.some((item) => item.id === deadline) && (
                <option value={deadline}>
                  마감일을 확인할 수 없습니다 — 다시 선택해 주세요
                </option>
              )}
            {options.data?.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <div className="form-grid">
          <label>
            예상 소요시간 (분, 선택)
            <input
              name="estimated_minutes"
              type="number"
              min={1}
              max={2147483647}
              step={1}
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
              placeholder="예: 60"
            />
          </label>
          <label>
            <span id={priorityLabelId}>우선순위</span>
            <select
              name="priority"
              aria-labelledby={priorityLabelId}
              value={priority}
              onChange={(event) => setPriority(Number(event.target.value))}
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          <span id={typeLabelId}>작업 유형</span>
          <select
            name="schedule_type"
            aria-labelledby={typeLabelId}
            value={scheduleType}
            onChange={(event) =>
              setScheduleType(event.target.value as ScheduleType)
            }
          >
            <option value="flexible">유동 작업</option>
            <option value="fixed">고정 일정</option>
          </select>
        </label>
        <div className="form-grid">
          <label>
            가능 시작 일시 (한국 시간, 선택)
            <input
              name="earliest_start"
              type="datetime-local"
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          </label>
          <label>
            최종 완료 일시 (한국 시간, 선택)
            <input
              name="latest_end"
              type="datetime-local"
              value={end}
              onChange={(event) => setEnd(event.target.value)}
            />
          </label>
        </div>
        <p className="muted small">
          가능 기간과 작업 유형을 저장합니다. 실제 캘린더 배치와 자동 일정
          생성은 준비 중입니다.
        </p>
        <label>
          <span id={descriptionId}>작업 설명 (선택)</span>
          <textarea
            name="description"
            aria-labelledby={descriptionId}
            rows={4}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            name="is_completed"
            checked={completed}
            onChange={(event) => setCompleted(event.target.checked)}
          />
          완료한 작업으로 표시
        </label>
        {error && <ErrorNotice message={error} />}
        <div className="form-actions">
          <button type="button" className="secondary" onClick={onCancel}>
            취소
          </button>
          <button type="submit">
            {busy ? "저장 중…" : initial ? "변경 사항 저장" : "작업 등록"}
          </button>
        </div>
      </fieldset>
      {options.error && (
        <button type="button" className="secondary" onClick={onCancel}>
          돌아가기
        </button>
      )}
    </form>
  );
}
