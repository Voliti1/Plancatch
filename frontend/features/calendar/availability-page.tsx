"use client";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { PageHeading } from "@/components/page-heading";
import { ErrorNotice, Loading } from "@/components/feedback";
import { api, errorMessage } from "@/lib/api/client";
import { useResource } from "@/lib/api/use-resource";
import { useUnsavedChanges } from "@/lib/unsaved-changes";
import { todaySeoul } from "./dates";
import "./availability.css";

type Window = { start_minutes: number; end_minutes: number };
type Day = { weekday: number; intervals: Window[] };
type Exception = { date: string; intervals: Window[] };
export type Availability = {
  revision: number;
  timezone: "Asia/Seoul";
  weekly: Day[];
  exceptions: Exception[];
};
const endpoint = "/api/scheduling/availability";
const days = [
  "월요일",
  "화요일",
  "수요일",
  "목요일",
  "금요일",
  "토요일",
  "일요일",
];
const fresh = () => ({ start_minutes: 540, end_minutes: 1080 });
const clock = (minutes: number) =>
  `${String(Math.floor((minutes % 1440) / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
function minute(value: string) {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

export function AvailabilityPage() {
  const load = useResource(
    useCallback(
      (signal: AbortSignal) => api<Availability>(endpoint, { signal }),
      [],
    ),
  );
  return (
    <div className="availability-page">
      <PageHeading
        eyebrow="WORKING HOURS"
        title="작업 가능한 시간"
        description="요일별 기본 시간과 특정 날짜에만 적용할 시간을 저장하세요. 한국 시간 기준입니다."
        action={
          <Link
            className="button secondary"
            href="/planning?availability=saved"
          >
            이 시간으로 자동 배치
          </Link>
        }
      />
      {load.loading ? (
        <Loading />
      ) : load.error ? (
        <ErrorNotice message={load.error} retry={load.reload} />
      ) : (
        load.data && (
          <AvailabilityEditor
            key={load.data.revision}
            initial={load.data}
            onReload={load.reload}
          />
        )
      )}
    </div>
  );
}

function AvailabilityEditor({
  initial,
  onReload,
}: {
  initial: Availability;
  onReload: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [day, setDay] = useState(todaySeoul);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const pending = useRef(false);
  const guard = useUnsavedChanges(JSON.stringify(draft));
  function change(next: Availability) {
    setDraft(next);
    setMessage("");
    setError("");
  }
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (pending.current) return;
        pending.current = true;
        setBusy(true);
        setError("");
        setMessage("");
        try {
          const result = await api<Availability>(endpoint, {
            method: "PUT",
            body: JSON.stringify(draft),
          });
          setDraft(result);
          guard.markSaved(JSON.stringify(result));
          setMessage("가능 시간을 저장했습니다. 새 미리보기부터 적용됩니다.");
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          pending.current = false;
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy}>
        <section className="card">
          <h2>요일별 기본 시간</h2>
          <p className="small muted">
            시간대는 하루에 최대 8개까지 나눌 수 있습니다. 시간대가 없으면 쉬는
            날입니다. 종료의 00:00은 그날이 끝나는 자정입니다.
          </p>
          {draft.weekly.map((entry) => (
            <WindowEditor
              key={entry.weekday}
              label={days[entry.weekday]}
              windows={entry.intervals}
              onChange={(intervals) =>
                change({
                  ...draft,
                  weekly: draft.weekly.map((d) =>
                    d.weekday === entry.weekday ? { ...d, intervals } : d,
                  ),
                })
              }
            />
          ))}
        </section>
        <section className="card">
          <h2>특정 날짜만 다르게 설정</h2>
          <p className="small muted">
            추가한 날짜는 요일별 기본 시간 대신 아래 설정을 사용합니다. 쉬는
            날로 두거나 가능한 시간을 추가하세요. 날짜를 삭제하면 기본 시간으로
            돌아갑니다.
          </p>
          <div className="availability-add-date">
            <label>
              예외 날짜
              <input
                type="date"
                value={day}
                onChange={(e) => setDay(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="secondary"
              disabled={!day || draft.exceptions.length >= 366}
              onClick={() => {
                if (draft.exceptions.some((e) => e.date === day)) {
                  setError("이미 추가한 날짜입니다.");
                  return;
                }
                change({
                  ...draft,
                  exceptions: [
                    ...draft.exceptions,
                    { date: day, intervals: [] },
                  ].sort((a, b) => a.date.localeCompare(b.date)),
                });
              }}
            >
              날짜 추가
            </button>
          </div>
          {draft.exceptions.map((entry) => (
            <div key={entry.date}>
              <WindowEditor
                label={entry.date}
                windows={entry.intervals}
                onChange={(intervals) =>
                  change({
                    ...draft,
                    exceptions: draft.exceptions.map((d) =>
                      d.date === entry.date ? { ...d, intervals } : d,
                    ),
                  })
                }
              />
              <button
                type="button"
                className="secondary"
                aria-label={`${entry.date} 예외 삭제`}
                onClick={() =>
                  change({
                    ...draft,
                    exceptions: draft.exceptions.filter(
                      (d) => d.date !== entry.date,
                    ),
                  })
                }
              >
                이 날짜 설정 삭제
              </button>
            </div>
          ))}
          {!draft.exceptions.length && (
            <p className="small muted">따로 설정한 날짜가 없습니다.</p>
          )}
        </section>
        <section className="card">
          <p className="small muted">
            이미 등록한 일정은 옮기지 않습니다. 가능 시간을 바꾼 뒤에는 자동
            배치 미리보기를 새로 만들어 주세요.
          </p>
          {error && <ErrorNotice message={error} />}
          {error && (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                if (guard.confirmDiscard()) onReload();
              }}
            >
              설정 다시 불러오기
            </button>
          )}
          {message && <p role="status">{message}</p>}
          <div className="form-actions">
            <button>{busy ? "저장 중…" : "가능 시간 저장"}</button>
          </div>
        </section>
      </fieldset>
    </form>
  );
}

function WindowEditor({
  label,
  windows,
  onChange,
}: {
  label: string;
  windows: Window[];
  onChange: (value: Window[]) => void;
}) {
  return (
    <fieldset className="availability-day">
      <legend>{label}</legend>
      {!windows.length && <span className="small muted">쉬는 날</span>}
      {windows.map((window, i) => (
        <div className="availability-window" key={i}>
          <label>
            시작
            <input
              type="time"
              step="60"
              required
              aria-label={`${label} ${i + 1} 시작`}
              value={clock(window.start_minutes)}
              onChange={(e) => {
                if (e.target.value)
                  onChange(
                    windows.map((w, n) =>
                      n === i
                        ? { ...w, start_minutes: minute(e.target.value) }
                        : w,
                    ),
                  );
              }}
            />
          </label>
          <label>
            종료
            <input
              type="time"
              step="60"
              required
              aria-label={`${label} ${i + 1} 종료`}
              value={clock(window.end_minutes)}
              onChange={(e) => {
                if (e.target.value)
                  onChange(
                    windows.map((w, n) =>
                      n === i
                        ? { ...w, end_minutes: minute(e.target.value) || 1440 }
                        : w,
                    ),
                  );
              }}
            />
          </label>
          <button
            type="button"
            className="secondary"
            aria-label={`${label} ${i + 1} 시간 삭제`}
            onClick={() => onChange(windows.filter((_, n) => n !== i))}
          >
            삭제
          </button>
        </div>
      ))}
      <button
        type="button"
        className="secondary"
        disabled={windows.length >= 8}
        onClick={() => onChange([...windows, fresh()])}
      >
        {label} 시간 추가
      </button>
    </fieldset>
  );
}
