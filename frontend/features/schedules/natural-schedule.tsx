"use client";
import { useEffect, useId, useRef, useState } from "react";
import { ErrorNotice } from "@/components/feedback";
import { api, errorMessage } from "@/lib/api/client";
import { useHydrated } from "@/lib/use-hydrated";
import { TaskForm } from "@/features/tasks/task-form";
import type { DeadlineInput } from "@/types/api";
import type { TaskInput } from "@/types/task";
import type { NaturalScheduleDraft } from "@/types/natural-schedule";

export function NaturalSchedule({
  onBusyChange,
  onSave,
  onSaveDeadline,
}: {
  onBusyChange: (busy: boolean) => void;
  onSave: (payload: TaskInput) => Promise<void>;
  onSaveDeadline: (payload: DeadlineInput) => Promise<void>;
}) {
  const hydrated = useHydrated();
  const textLabelId = useId();
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<NaturalScheduleDraft | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const active = useRef(true);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      request.current?.abort();
    };
  }, []);

  function change(value: string) {
    setText(value);
    setDraft(null);
    setError("");
  }

  async function preview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current || saving) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    onBusyChange(true);
    setError("");
    setDraft(null);
    try {
      const result = await api<NaturalScheduleDraft>(
        "/api/schedules/interpret",
        {
          method: "POST",
          body: JSON.stringify({ text: text.trim() }),
          signal: controller.signal,
        },
      );
      if (active.current) {
        setDraft(result);
        setVersion((value) => value + 1);
      }
    } catch (err) {
      if (active.current) setError(errorMessage(err));
    } finally {
      request.current = null;
      if (active.current) {
        setBusy(false);
        onBusyChange(false);
      }
    }
  }

  async function save<T>(payload: T, handler: (value: T) => Promise<void>) {
    setSaving(true);
    onBusyChange(true);
    try {
      await handler(payload);
    } catch (err) {
      if (active.current) {
        setSaving(false);
        onBusyChange(false);
      }
      throw err;
    }
  }

  return (
    <section className="card source-registration manual-registration-card natural-registration">
      <h2>문장으로 일정 등록</h2>
      <p className="muted small">
        날짜와 할 일을 편하게 적어주세요. 한 번에 일정 하나를 입력하고, 확인한
        뒤 등록합니다.
      </p>
      <form onSubmit={preview}>
        <fieldset disabled={busy || saving || !hydrated}>
          <label>
            <span id={textLabelId}>일정 설명</span>
            <textarea
              aria-labelledby={textLabelId}
              ref={input}
              rows={3}
              maxLength={1000}
              required
              value={text}
              placeholder="예: 내일 오후 3시 회의"
              onChange={(event) => change(event.target.value)}
            />
          </label>
          <div className="natural-examples" aria-label="입력 예시">
            {[
              "내일 오후 3시 회의",
              "금요일까지 보고서 제출",
              "모레 오전 10시부터 11시 면접",
            ].map((example) => (
              <button
                key={example}
                type="button"
                className="secondary"
                onClick={() => {
                  change(example);
                  input.current?.focus();
                }}
              >
                {example}
              </button>
            ))}
          </div>
          <p className="small muted">
            한국 시간 기준 · 종료 시간이 없으면 1시간, 마감 시간이 없으면
            23:59를 제안합니다. 반복 일정은 아직 지원하지 않습니다.
          </p>
          <div className="form-actions">
            <button type="submit" disabled={!text.trim()}>
              {busy ? "확인 중…" : "일정 미리보기"}
            </button>
          </div>
        </fieldset>
      </form>
      {error && <ErrorNotice message={error} />}
      {draft && (
        <div className="natural-preview" role="region" aria-label="일정 확인">
          <h3>내용을 확인하고 등록하세요</h3>
          <p className="small muted">
            ‘내일’ 등의 기준:{" "}
            {new Intl.DateTimeFormat("ko-KR", {
              timeZone: "Asia/Seoul",
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(draft.reference_at))}{" "}
            · 아직 등록되지 않았습니다.
          </p>
          {draft.notices.length > 0 && (
            <ul className="notice natural-notices" aria-label="확인할 내용">
              {draft.notices.map((notice) => (
                <li key={notice}>{notice}</li>
              ))}
            </ul>
          )}
          <TaskForm
            key={version}
            draft={draft}
            variant="calendar"
            submitLabel="일정 등록"
            disabled={saving}
            onSave={(payload) => save(payload, onSave)}
            onSaveDeadline={(payload) => save(payload, onSaveDeadline)}
            onCancel={() => {
              setDraft(null);
              input.current?.focus();
            }}
          />
        </div>
      )}
    </section>
  );
}
