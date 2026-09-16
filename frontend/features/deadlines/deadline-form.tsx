"use client";
import { useState } from "react";
import { toSeoulInput, seoulInputToUtc } from "@/lib/date/seoul";
import { errorMessage } from "@/lib/api/client";
import { ErrorNotice } from "@/components/feedback";
import { useHydrated } from "@/lib/use-hydrated";
import type { Deadline, DeadlineInput } from "@/types/api";
export function DeadlineForm({
  initial,
  onSave,
}: {
  initial?: Deadline;
  onSave: (payload: DeadlineInput) => Promise<void>;
}) {
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [dueAt, setDueAt] = useState(
    initial ? toSeoulInput(initial.due_at) : "",
  );
  const [description, setDescription] = useState(initial?.description ?? "");
  const [deadlineType, setDeadlineType] = useState(
    initial?.deadline_type ?? "",
  );
  const [confirmed, setConfirmed] = useState(initial?.is_confirmed ?? false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (!title.trim()) throw new Error("제목을 입력해 주세요.");
      await onSave({
        title: title.trim(),
        due_at: initial && dueAt === toSeoulInput(initial.due_at)
          ? initial.due_at
          : seoulInputToUtc(dueAt),
        description: description.trim() || null,
        deadline_type: deadlineType.trim() || null,
        source_id: initial?.source_id ?? null,
        is_confirmed: confirmed,
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <fieldset disabled={busy || !hydrated}>
        <label>
          마감 제목
          <input
            name="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            maxLength={255}
            placeholder="예: 프로젝트 제안서 제출"
          />
        </label>
        <div className="form-grid">
          <label>
            마감 일시 (한국 시간)
            <input
              name="due_at"
              type="datetime-local"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
              required
            />
          </label>
          <label>
            유형 (선택)
            <input
              name="deadline_type"
              value={deadlineType}
              onChange={(event) => setDeadlineType(event.target.value)}
              maxLength={50}
              placeholder="예: 과제, 시험, 프로젝트"
            />
          </label>
        </div>
        <label>
          설명 (선택)
          <textarea
            name="description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={4}
            placeholder="제출 방법이나 기억할 내용을 남겨 주세요."
          />
        </label>
        <label className="checkbox">
          <input
            name="is_confirmed"
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          확인한 마감일로 표시
        </label>
        {error && <ErrorNotice message={error} />}
        <button type="submit">
          {busy ? "저장 중…" : initial ? "변경 사항 저장" : "마감일 등록"}
        </button>
      </fieldset>
    </form>
  );
}
