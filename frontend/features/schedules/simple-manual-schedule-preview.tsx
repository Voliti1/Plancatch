"use client";

import { useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import "./simple-manual-schedule-preview.css";

type ScheduleDraft = {
  title: string;
  date: string;
  start: string;
  end: string;
  allDay: boolean;
  memo: string;
};

// UI preview only. Calendar events and tasks are never created here.
export function SimpleManualSchedulePreview({
  onCancel,
}: {
  onCancel: () => void;
}) {
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const [memoOpen, setMemoOpen] = useState(false);
  const [allDay, setAllDay] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<ScheduleDraft | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const draft: ScheduleDraft = {
      title: String(data.get("title") ?? "").trim(),
      date: String(data.get("date") ?? ""),
      start: String(data.get("start") ?? ""),
      end: String(data.get("end") ?? ""),
      allDay,
      memo: String(data.get("memo") ?? "").trim(),
    };
    setPreview(null);
    if (!draft.title) {
      setError("일정명을 입력해 주세요.");
      form.current?.querySelector<HTMLInputElement>('[name="title"]')?.focus();
      return;
    }
    if (!draft.date) {
      setError("날짜를 선택해 주세요.");
      return;
    }
    if (!draft.allDay && (!draft.start || !draft.end)) {
      setError("시작 시간과 종료 시간을 입력해 주세요.");
      return;
    }
    if (!draft.allDay && draft.end <= draft.start) {
      setError("종료 시간은 시작 시간보다 늦게 설정해 주세요.");
      return;
    }
    setError("");
    setPreview(draft);
  }

  return (
    <section className="card simple-schedule-preview">
      <div className="simple-schedule-heading">
        <h2>수동 일정 등록</h2>
        <span className="simple-schedule-sample">미리보기</span>
      </div>
      <p className="small muted simple-schedule-intro">
        일정에 필요한 내용만 간단히 입력하세요.
      </p>
      <form
        ref={form}
        onSubmit={submit}
        noValidate
        onInput={() => {
          setError("");
          setPreview(null);
        }}
      >
        <label htmlFor={`${id}-title`}>
          일정명
          <input
            id={`${id}-title`}
            className="simple-schedule-title"
            name="title"
            maxLength={120}
            placeholder="예: 팀 프로젝트 회의"
            required
          />
        </label>
        <div className="simple-schedule-date-heading">
          <label htmlFor={`${id}-date`}>날짜</label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={allDay}
              onChange={(event) => {
                setAllDay(event.target.checked);
                setError("");
                setPreview(null);
              }}
            />
            하루 종일
          </label>
        </div>
        <input
          id={`${id}-date`}
          name="date"
          type="date"
          defaultValue="2026-10-20"
          required
        />
        <div className="simple-schedule-times" hidden={allDay}>
          <label htmlFor={`${id}-start`}>
            시작 시간
            <input
              id={`${id}-start`}
              name="start"
              type="time"
              defaultValue="14:00"
              disabled={allDay}
            />
          </label>
          <span aria-hidden="true">–</span>
          <label htmlFor={`${id}-end`}>
            종료 시간
            <input
              id={`${id}-end`}
              name="end"
              type="time"
              defaultValue="15:00"
              disabled={allDay}
            />
          </label>
        </div>
        <p className="small muted simple-schedule-timezone">한국 시간 기준</p>
        <button
          className="text-button simple-schedule-memo-toggle"
          type="button"
          aria-expanded={memoOpen}
          aria-controls={`${id}-memo-section`}
          onClick={() => setMemoOpen(!memoOpen)}
        >
          {memoOpen ? "메모 접기" : "＋ 메모 추가"}
          <span className="small muted">선택</span>
        </button>
        <div id={`${id}-memo-section`} hidden={!memoOpen}>
          <label htmlFor={`${id}-memo`}>
            메모
            <textarea
              id={`${id}-memo`}
              name="memo"
              rows={3}
              maxLength={1000}
              placeholder="장소나 준비물 등을 자유롭게 적어보세요."
            />
          </label>
        </div>
        {error && (
          <p role="alert" className="simple-schedule-error">
            {error}
          </p>
        )}
        <div className="form-actions simple-schedule-actions">
          <button type="button" className="secondary" onClick={onCancel}>
            취소
          </button>
          <button type="submit">일정 등록</button>
        </div>
      </form>
      <p className="small muted simple-schedule-disclaimer">
        샘플 화면이며 실제 일정은 저장되지 않습니다.
      </p>
      {preview && (
        <div className="simple-schedule-result" role="status">
          <span className="small">등록 미리보기 · 실제 저장 안 됨</span>
          <strong>{preview.title}</strong>
          <span>
            {new Intl.DateTimeFormat("ko-KR", {
              month: "long",
              day: "numeric",
              weekday: "short",
              timeZone: "Asia/Seoul",
            }).format(new Date(`${preview.date}T12:00:00+09:00`))}
            {" · "}
            {preview.allDay ? "하루 종일" : `${preview.start} – ${preview.end}`}
          </span>
          {preview.memo && <p>{preview.memo}</p>}
        </div>
      )}
    </section>
  );
}
