"use client";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ErrorNotice } from "@/components/feedback";
import { api, errorMessage } from "@/lib/api/client";
import { TaskForm } from "@/features/tasks/task-form";
import type { DeadlineInput } from "@/types/api";
import type { TaskInput } from "@/types/task";
import type { NaturalScheduleDraft } from "@/types/natural-schedule";

export function NaturalSchedule({
  enabled = true,
  initialDraft,
  deadlineId,
  onCancel,
  onBusyChange,
  onSave,
  onSaveDeadline,
}: {
  enabled?: boolean;
  initialDraft?: NaturalScheduleDraft;
  deadlineId?: string;
  onCancel: () => void;
  onBusyChange: (busy: boolean) => void;
  onSave: (payload: TaskInput) => Promise<void>;
  onSaveDeadline: (payload: DeadlineInput) => Promise<void>;
}) {
  const textLabelId = useId();
  const [text, setText] = useState("");
  const [draft, setDraft] = useState(initialDraft);
  const [version, setVersion] = useState(0);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [composing, setComposing] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const request = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const manualEdit = useRef(false);
  const currentDraft = useRef(initialDraft);
  const interpreted = useRef<string | null>(null);

  function cancelReading() {
    generation.current++;
    request.current?.abort();
    request.current = null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }
  function editSentence(value: string) {
    cancelReading();
    // A new sentence replaces a previous proposal; clearing it keeps editable fields.
    if (value.trim() && (currentDraft.current || manualEdit.current)) {
      currentDraft.current = undefined;
      setDraft(undefined);
      setVersion((v) => v + 1);
    }
    manualEdit.current = false;
    interpreted.current = null;
    setText(value);
    setError("");
    setReading(Boolean(value.trim()));
  }
  function editFields() {
    manualEdit.current = true;
    cancelReading();
    setReading(false);
    setError("");
  }

  useEffect(() => {
    if (
      !enabled ||
      composing ||
      !text.trim() ||
      manualEdit.current ||
      interpreted.current === text.trim()
    ) {
      return;
    }
    const controller = new AbortController();
    const identity = ++generation.current;
    request.current = controller;
    timer.current = setTimeout(async () => {
      try {
        const result = await api<NaturalScheduleDraft>(
          "/api/schedules/interpret",
          {
            method: "POST",
            body: JSON.stringify({ text: text.trim() }),
            signal: controller.signal,
          },
        );
        if (controller.signal.aborted || identity !== generation.current)
          return;
        interpreted.current = text.trim();
        currentDraft.current = result;
        setDraft(result);
        setVersion((v) => v + 1);
        setError("");
      } catch (err) {
        if (!controller.signal.aborted && identity === generation.current)
          setError(errorMessage(err));
      } finally {
        if (!controller.signal.aborted && identity === generation.current) {
          request.current = null;
          setReading(false);
        }
      }
    }, 600);
    return () => {
      controller.abort();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [text, enabled, retry, composing]);

  async function save<T>(payload: T, handler: (value: T) => Promise<void>) {
    cancelReading();
    setSaving(true);
    onBusyChange(true);
    try {
      await handler(payload);
    } catch (err) {
      setSaving(false);
      onBusyChange(false);
      throw err;
    }
  }

  return (
    <section className="card source-registration manual-registration-card natural-registration">
      <div className="manual-registration-heading">
        <h2>수동 일정 등록</h2>
        <Link
          className="text-button"
          href="/deadlines"
          aria-disabled={saving || undefined}
          onClick={(event) => {
            if (saving) event.preventDefault();
          }}
        >
          등록한 일정 보기 →
        </Link>
      </div>
      <p className="small muted">
        문장으로 입력하거나 아래 항목을 직접 입력해 등록하세요.
      </p>
      <div className="natural-sentence-input">
        <h3>문장으로 일정 등록</h3>
        <label>
          <span id={textLabelId}>일정 설명 (선택)</span>
          <textarea
            aria-labelledby={textLabelId}
            ref={input}
            rows={2}
            maxLength={1000}
            disabled={saving}
            value={text}
            placeholder="예: 내일 오후 3시부터 4시까지 회의"
            onChange={(event) => editSentence(event.target.value)}
            onCompositionStart={() => {
              cancelReading();
              setComposing(true);
            }}
            onCompositionEnd={() => setComposing(false)}
          />
        </label>
        <div className="natural-examples" aria-label="입력 예시">
          {[
            "내일 오후 3시부터 4시까지 회의",
            "금요일까지 보고서 제출",
            "모레 오전 10시부터 11시 면접",
          ].map((example) => (
            <button
              key={example}
              type="button"
              className="secondary"
              disabled={saving}
              onClick={() => {
                editSentence(example);
                input.current?.focus();
              }}
            >
              {example}
            </button>
          ))}
        </div>
        <p className="small muted">
          시각 하나는 마감일로, 시작·종료 시각이나 시작 시각과 소요시간은 할
          일로 제안합니다. 날짜만 있는 마감일은 23:59로 제안합니다.
        </p>
        {reading && (
          <p className="small muted" role="status">
            문장에서 일정을 읽는 중…
          </p>
        )}
        {error && (
          <ErrorNotice
            message={`${error} 아래 항목을 직접 입력해도 됩니다.`}
            retry={() => {
              manualEdit.current = false;
              interpreted.current = null;
              setReading(true);
              setRetry((v) => v + 1);
            }}
          />
        )}
      </div>
      <div className="natural-preview" role="region" aria-label="일정 입력">
        {draft && (
          <p className="small muted">
            문장에서 읽은 내용을 확인하고 필요한 항목을 수정해 주세요. 아직
            등록되지 않았습니다.
          </p>
        )}
        {draft && draft.notices.length > 0 && (
          <ul className="notice natural-notices" aria-label="확인할 내용">
            {draft.notices.map((notice) => (
              <li key={notice}>{notice}</li>
            ))}
          </ul>
        )}
        <TaskForm
          key={version}
          deadlineId={deadlineId}
          draft={draft}
          variant="calendar"
          submitLabel="일정 등록"
          disabled={saving}
          submitDisabled={reading}
          onUserEdit={editFields}
          onSave={(payload) => save(payload, onSave)}
          onSaveDeadline={(payload) => save(payload, onSaveDeadline)}
          onCancel={onCancel}
        />
      </div>
    </section>
  );
}
