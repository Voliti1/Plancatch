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
type Day = { weekday: number; intervals: Window[]; rest_day?: boolean };
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
const presets = [
  {
    id: "office",
    label: "평일 오전 9시~오후 6시",
    count: 5,
    start: 540,
    end: 1080,
  },
  {
    id: "evening",
    label: "평일 저녁 오후 6시~10시",
    count: 5,
    start: 1080,
    end: 1320,
  },
  {
    id: "daily",
    label: "매일 오전 9시~오후 10시",
    count: 7,
    start: 540,
    end: 1320,
  },
];
function validateWindows(windows: Window[]) {
  const sorted = [...windows].sort((a, b) => a.start_minutes - b.start_minutes);
  if (sorted.some((window) => window.end_minutes <= window.start_minutes))
    return "종료 시간은 시작 시간보다 늦어야 해요.";
  if (
    sorted.some(
      (window, i) => i > 0 && sorted[i - 1].end_minutes > window.start_minutes,
    )
  )
    return "시간대가 서로 겹쳐요.";
  return "";
}

function QuickHours({
  onPreset,
  onBulk,
}: {
  onPreset: (weekly: Day[]) => void;
  onBulk: (days: number[], interval: Window) => void;
}) {
  const [presetId, setPresetId] = useState("custom");
  const preset = presets.find((item) => item.id === presetId);
  const [selected, setSelected] = useState<number[]>([]);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("18:00");
  const [error, setError] = useState("");
  return (
    <section className="card availability-quick">
      <h2>빠른 설정</h2>
      <label>
        기본 시간 프리셋
        <select
          value={presetId}
          onChange={(event) => setPresetId(event.target.value)}
        >
          <option value="custom">직접 설정</option>
          {presets.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      {preset && (
        <div className="availability-preset-preview">
          <p className="small" role="status">
            {preset.count === 5 ? "월~금" : "월~일"} {clock(preset.start)}~
            {clock(preset.end)}
            {preset.count === 5 ? " · 주말은 휴식일" : ""}. 적용한 뒤 아래에서
            저장하면 반영돼요.
          </p>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              onPreset(
                days.map((_, weekday) =>
                  weekday < preset.count
                    ? {
                        weekday,
                        intervals: [
                          {
                            start_minutes: preset.start,
                            end_minutes: preset.end,
                          },
                        ],
                      }
                    : { weekday, intervals: [], rest_day: true },
                ),
              );
              setPresetId("custom");
            }}
          >
            이 기본 시간 적용
          </button>
        </div>
      )}
      <details>
        <summary>여러 요일에 같은 시간 적용</summary>
        <fieldset className="availability-bulk">
          <legend>적용할 요일</legend>
          <div className="availability-bulk-days">
            {days.map((label, weekday) => (
              <label className="checkbox-row" key={label}>
                <input
                  type="checkbox"
                  checked={selected.includes(weekday)}
                  onChange={(event) =>
                    setSelected(
                      event.target.checked
                        ? [...selected, weekday]
                        : selected.filter((d) => d !== weekday),
                    )
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <div className="availability-window">
            <label>
              일괄 적용 시작
              <input
                type="time"
                value={start}
                onChange={(event) => {
                  setStart(event.target.value);
                  setError("");
                }}
              />
            </label>
            <label>
              일괄 적용 종료
              <input
                type="time"
                value={end}
                onChange={(event) => {
                  setEnd(event.target.value);
                  setError("");
                }}
              />
            </label>
          </div>
          <p className="small muted">
            선택한 요일의 기존 시간대를 이 시간으로 교체해요.
          </p>
          {error && <ErrorNotice message={error} />}
          <button
            type="button"
            className="secondary"
            disabled={!selected.length || !start || !end}
            onClick={() => {
              const interval = {
                start_minutes: minute(start),
                end_minutes: minute(end) || 1440,
              };
              const message = validateWindows([interval]);
              if (message) {
                setError(message);
                return;
              }
              onBulk(selected, interval);
            }}
          >
            선택한 요일에 적용
          </button>
        </fieldset>
      </details>
    </section>
  );
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
        eyebrow="작업 가능한 시간"
        title="작업 가능한 시간"
        description="요일별 기본 시간과 특정 날짜에만 적용할 시간을 저장하세요. 한국 시간 기준이에요."
        action={
          <Link
            className="button secondary"
            href="/planning?availability=saved"
          >
            이 조건으로 시간 추천받기
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
  const [saved, setSaved] = useState(initial);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
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
        for (const entry of [...draft.weekly, ...draft.exceptions]) {
          const message = validateWindows(entry.intervals);
          if (message) {
            setError(
              ("weekday" in entry ? days[entry.weekday] : entry.date) +
                ": " +
                message,
            );
            return;
          }
        }
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
          setSaved(result);
          guard.markSaved(JSON.stringify(result));
          setMessage("가능 시간을 저장했어요. 새 미리보기부터 적용돼요.");
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          pending.current = false;
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy}>
        <QuickHours
          onPreset={(weekly) => change({ ...draft, weekly })}
          onBulk={(selected, interval) =>
            change({
              ...draft,
              weekly: draft.weekly.map((item) =>
                selected.includes(item.weekday)
                  ? { weekday: item.weekday, intervals: [interval] }
                  : item,
              ),
            })
          }
        />
        <section className="card">
          <h2>요일별 기본 시간</h2>
          <div
            className="availability-presets"
            role="group"
            aria-label="요일별 빠른 설정"
          >
            <button
              type="button"
              className="secondary"
              onClick={() =>
                change({
                  ...draft,
                  weekly: days.map((_, weekday) => ({
                    weekday,
                    intervals: weekday < 5 ? [fresh()] : [],
                    rest_day: weekday >= 5,
                  })),
                })
              }
            >
              평일 09:00~18:00
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                change({
                  ...draft,
                  weekly: days.map((_, weekday) => ({
                    weekday,
                    intervals: [fresh()],
                    rest_day: false,
                  })),
                })
              }
            >
              매일 09:00~18:00
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                const monday = draft.weekly.find((item) => item.weekday === 0);
                if (!monday) return;
                change({
                  ...draft,
                  weekly: draft.weekly.map((item) =>
                    item.weekday < 5
                      ? {
                          ...item,
                          rest_day: monday.rest_day ?? false,
                          intervals: monday.intervals.map((interval) => ({
                            ...interval,
                          })),
                        }
                      : item,
                  ),
                });
              }}
            >
              월요일 시간을 평일 전체에 복사
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                change({
                  ...draft,
                  weekly: draft.weekly.map((item) =>
                    item.weekday >= 5
                      ? { ...item, intervals: [], rest_day: true }
                      : item,
                  ),
                })
              }
            >
              주말 쉬는 날로 설정
            </button>
          </div>
          <p className="small muted">
            하루에 시간대를 최대 8개까지 추가할 수 있어요. 종료를 00:00으로
            입력하면 다음 날 0시까지로 설정돼요.
          </p>
          {draft.weekly.map((entry) => (
            <WindowEditor
              key={entry.weekday}
              label={days[entry.weekday]}
              windows={entry.intervals}
              resting={entry.rest_day ?? false}
              onRestChange={(rest_day) =>
                change({
                  ...draft,
                  weekly: draft.weekly.map((item) =>
                    item.weekday === entry.weekday
                      ? { ...item, rest_day }
                      : item,
                  ),
                })
              }
              onChange={(intervals) =>
                change({
                  ...draft,
                  weekly: draft.weekly.map((d) =>
                    d.weekday === entry.weekday
                      ? { weekday: d.weekday, intervals }
                      : d,
                  ),
                })
              }
            />
          ))}
        </section>
        <section className="card">
          <h2>특정 날짜만 다르게 설정</h2>
          <p className="small muted">
            추가한 날짜는 요일별 기본 시간 대신 아래 설정을 사용해요. 쉬는 날로
            두거나 가능한 시간을 추가하세요. 날짜를 삭제하면 기본 시간으로
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
                  setError("이미 추가한 날짜예요.");
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
                resting={!entry.intervals.length}
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
            <p className="small muted">따로 설정한 날짜가 없어요.</p>
          )}
        </section>
        <section className="card">
          <p className="small muted">
            이미 등록한 일정은 옮기지 않아요. 가능 시간을 바꾼 뒤에는 추천
            시간을 다시 확인해 주세요.
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
          {!dirty && (
            <div className="form-actions">
              <button disabled={busy}>가능 시간 저장</button>
            </div>
          )}
        </section>
      </fieldset>
      {dirty && (
        <div
          className="availability-save-bar"
          role="region"
          aria-label="가능 시간 변경 저장"
        >
          <span role="status">변경 사항이 있습니다</span>
          <button type="submit" disabled={busy}>
            {busy ? "저장 중…" : "가능 시간 저장"}
          </button>
        </div>
      )}
    </form>
  );
}

function WindowEditor({
  label,
  windows,
  resting,
  onRestChange,
  onChange,
}: {
  label: string;
  windows: Window[];
  resting: boolean;
  onRestChange?: (value: boolean) => void;
  onChange: (value: Window[]) => void;
}) {
  const error = validateWindows(windows);
  return (
    <fieldset className="availability-day">
      <legend>{label}</legend>
      {!windows.length && (
        <div className="availability-day-status">
          <span className="small muted">
            {resting ? "휴식일" : "설정 없음"}
          </span>
          {onRestChange && (
            <button
              type="button"
              className="text-button"
              onClick={() => onRestChange(!resting)}
            >
              {resting ? "휴식일 해제" : "휴식일로 설정"}
            </button>
          )}
        </div>
      )}
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
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
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
