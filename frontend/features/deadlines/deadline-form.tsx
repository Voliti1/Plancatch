"use client";
import { CategorySelect, type Category } from "@/components/category-badge";
import { useScheduleTime } from "@/features/settings/time-zone";
import { useRef, useState } from "react";
import { errorMessage } from "@/lib/api/client";
import { ErrorNotice } from "@/components/feedback";
import { useHydrated } from "@/lib/use-hydrated";
import { useUnsavedChanges } from "@/lib/unsaved-changes";
import type { Deadline, DeadlineInput } from "@/types/api";
import { parseSafetyBuffer, splitSafetyBuffer } from "./safety-buffer";
import { SafetyBufferSettings } from "./safety-buffer-settings";
import {
  ReminderSettings,
  validateReminders,
} from "@/features/google-calendar/reminder-settings";
import {
  newReminderSettings,
  type GoogleReminderSettings,
} from "@/types/google-reminders";
export function DeadlineForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Deadline;
  onSave: (payload: DeadlineInput) => Promise<void>;
  onCancel?: () => void;
}) {
  const { toLocalInput, fromLocalInput, zoneLabel } = useScheduleTime();
  const hydrated = useHydrated();
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reminders, setReminders] = useState<GoogleReminderSettings | null>(
    initial ? (initial.google_reminders ?? null) : newReminderSettings(),
  );
  const [category, setCategory] = useState<Category | null>(
    initial?.category ?? null,
  );
  const [title, setTitle] = useState(initial?.title ?? "");
  const [dueAt, setDueAt] = useState(
    initial ? toLocalInput(initial.due_at) : "",
  );
  const [description, setDescription] = useState(initial?.description ?? "");
  const [deadlineType, setDeadlineType] = useState(
    initial?.deadline_type ?? "",
  );
  const [confirmed, setConfirmed] = useState(initial?.is_confirmed ?? false);
  const [safetyEnabled, setSafetyEnabled] = useState(
    initial?.safety_buffer_minutes != null,
  );
  const [safetyParts, setSafetyParts] = useState(() =>
    splitSafetyBuffer(initial?.safety_buffer_minutes ?? null),
  );
  const { markSaved, confirmDiscard } = useUnsavedChanges(
    JSON.stringify([
      title,
      category,
      dueAt,
      description,
      deadlineType,
      confirmed,
      safetyEnabled,
      safetyParts,
      reminders,
    ]),
  );
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      if (!title.trim()) throw new Error("제목을 입력해 주세요.");
      validateReminders(reminders);
      await onSave({
        ...(reminders ? { google_reminders: reminders } : {}),
        title: title.trim(),
        ...(category !== (initial?.category ?? null) ? { category } : {}),
        due_at:
          initial && dueAt === toLocalInput(initial.due_at)
            ? initial.due_at
            : fromLocalInput(dueAt),
        safety_buffer_minutes: safetyEnabled
          ? parseSafetyBuffer(safetyParts)
          : null,
        description: description.trim() || null,
        deadline_type: deadlineType.trim() || null,
        source_id: initial?.source_id ?? null,
        is_confirmed: confirmed,
      });
      markSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <CategorySelect value={category} onChange={setCategory} disabled={busy} />
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
            마감 일시 ({zoneLabel})
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
        <SafetyBufferSettings
          safetyEnabled={safetyEnabled}
          safetyParts={safetyParts}
          onEnabledChange={setSafetyEnabled}
          onPartsChange={setSafetyParts}
        />
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
        <ReminderSettings
          allowPreserve={Boolean(initial) && initial?.google_reminders == null}
          value={reminders}
          onChange={setReminders}
        />
        {error && <ErrorNotice message={error} />}
        <div className="form-actions">
          {onCancel && (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                if (confirmDiscard()) onCancel();
              }}
            >
              취소
            </button>
          )}
          <button type="submit">
            {busy ? "저장 중…" : initial ? "변경 사항 저장" : "마감일 등록"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
