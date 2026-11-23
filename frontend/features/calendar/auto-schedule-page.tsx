"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type Ref } from "react";
import { PageHeading } from "@/components/page-heading";
import { ErrorNotice, Loading } from "@/components/feedback";
import { api, errorMessage } from "@/lib/api/client";
import { useResource } from "@/lib/api/use-resource";
import { formatSeoul, seoulInputToUtc, toSeoulInput } from "@/lib/date/seoul";
import { useUnsavedChanges } from "@/lib/unsaved-changes";
import { tasksApi } from "@/features/tasks/api";
import { googleCalendarApi } from "@/features/google-calendar/api";
import { TaskPlacements } from "./task-placements";
import type { SavedState } from "./plan-history";
import { addDays, dayLabel, todaySeoul, utcMidnight } from "./dates";
import {
  loadPlanningTasks,
  PlanningTaskPicker,
  type PlanningTask,
} from "./planning-task-picker";
import type { Availability } from "./availability-page";
import "./auto-schedule.css";

type Block = {
  id: string;
  task_id: string;
  title: string;
  start_at: string;
  end_at: string;
};
type Plan = {
  id: string;
  request: {
    start_at: string;
    end_at: string;
    include_google: boolean;
    task_ids?: string[];
  };
  blocks: Block[];
  details: {
    replace_existing?: boolean;
    replaced_blocks?: Block[];
    blocked: boolean;
    warnings: string[];
    google_state: string;
    unplaced: { task_id: string; title: string; reason: string }[];
    tasks: {
      id: string;
      title: string;
      minutes: number | null;
      limit: string;
      priority: number;
      uses_safety_deadline: boolean;
    }[];
  };
  expires_at: string;
  approved_at: string | null;
  approved_event_ids: string[];
  saved_state?: SavedState | null;
};
const days = ["월", "화", "수", "목", "금", "토", "일"];
const businessDays = [0, 1, 2, 3, 4];
const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
function endOfWork(local: string, duration: number): string {
  try {
    return new Date(
      Date.parse(seoulInputToUtc(local)) + duration,
    ).toISOString();
  } catch {
    return "";
  }
}

function describeHours(availability?: Availability) {
  if (!availability) return "계정에 설정한 가능 시간";
  const workdays = availability.weekly.filter((day) => day.intervals.length);
  if (!workdays.length) return "설정한 기본 가능 시간 없음";
  const first = workdays[0].intervals;
  const same =
    first.length === 1 &&
    workdays.every(
      (day) =>
        day.intervals.length === 1 &&
        day.intervals[0].start_minutes === first[0].start_minutes &&
        day.intervals[0].end_minutes === first[0].end_minutes,
    );
  const label =
    workdays.length === 7
      ? "매일"
      : workdays.length === 5 && workdays.every((day) => day.weekday < 5)
        ? "평일"
        : workdays.map((day) => days[day.weekday]).join("·");
  return same
    ? label +
        " " +
        clock(first[0].start_minutes) +
        "~" +
        clock(first[0].end_minutes)
    : "요일별로 설정한 가능 시간";
}

export function AutoSchedulePage({
  initialPlanId,
  initialReplace = false,
  initialSavedAvailability = true,
  initialTaskId,
  retryPlan = false,
}: {
  initialPlanId?: string;
  initialReplace?: boolean;
  initialSavedAvailability?: boolean;
  initialTaskId?: string;
  retryPlan?: boolean;
}) {
  const [replace, setReplace] = useState(initialReplace);
  const [useSaved, setUseSaved] = useState(initialSavedAvailability);
  const restore = useResource(
    useCallback(
      (signal: AbortSignal) =>
        initialPlanId
          ? api<Plan>(
              `/api/scheduling/plans/${encodeURIComponent(initialPlanId)}`,
              { signal },
            )
          : Promise.resolve(null),
      [initialPlanId],
    ),
  );
  const [selection, setSelection] = useState<PlanningTask[] | null>(null);
  const retryIds = retryPlan
    ? (restore.data?.request.task_ids?.join(",") ?? "")
    : "";
  const seeds = useResource(
    useCallback(
      (signal: AbortSignal) => {
        const ids = initialTaskId
          ? [initialTaskId]
          : retryIds
            ? retryIds.split(",").slice(0, 20)
            : [];
        return ids.length
          ? loadPlanningTasks(replace, signal, "", 0, ids)
          : Promise.resolve(null);
      },
      [initialTaskId, retryIds, replace],
    ),
  );
  const selected =
    selection ??
    seeds.data?.entries.filter((task) => Boolean(task.estimated_minutes)) ??
    [];
  const availability = useResource(
    useCallback(
      (signal: AbortSignal) =>
        api<Availability>("/api/scheduling/availability", { signal }),
      [],
    ),
  );
  const connection = useResource(googleCalendarApi.status);
  const [first, setFirst] = useState(todaySeoul);
  const [last, setLast] = useState(() => addDays(todaySeoul(), 13));
  const [begin, setBegin] = useState(540),
    [end, setEnd] = useState(1080);
  const [weekdays, setWeekdays] = useState(businessDays);
  const [chunk, setChunk] = useState(60),
    [google, setGoogle] = useState(true);
  const [plan, setPlan] = useState<Plan | null>(null),
    [ignoreRestored, setIgnoreRestored] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef(false),
    active = useRef(true);
  const conditions = useRef<HTMLDetailsElement>(null);
  const conditionsSummary = useRef<HTMLElement>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (plan && !plan.approved_at) previewHeading.current?.focus();
  }, [plan]);
  const shown = plan ?? (!ignoreRestored && !retryPlan ? restore.data : null);
  const weekdayLabel =
    weekdays.length === days.length
      ? "매일"
      : weekdays.length === businessDays.length &&
          businessDays.every((day) => weekdays.includes(day))
        ? "평일"
        : days.filter((_, day) => weekdays.includes(day)).join("·") ||
          "요일 미선택";
  return (
    <div className="auto-schedule">
      <PageHeading
        eyebrow="TIME SUGGESTIONS"
        title="할 일 시간 추천"
        description="언제 할지 정하지 못한 일이 있나요? 할 일을 고르면 가능한 시간을 찾아드려요."
        action={
          <div className="planning-heading-actions">
            <Link className="button secondary" href="/planning/history">
              시간 추천 기록
            </Link>
          </div>
        }
      />
      <form
        className="card"
        onSubmit={async (e) => {
          e.preventDefault();
          if (pending.current) return;
          setError("");
          if (!selected.length) {
            setError("시간을 정할 할 일을 선택해 주세요.");
            return;
          }
          pending.current = true;
          setBusy(true);
          try {
            const result = await api<Plan>("/api/scheduling/preview", {
              method: "POST",
              body: JSON.stringify({
                task_ids: selected.map((task) => task.id),
                start_at: utcMidnight(first),
                end_at: utcMidnight(addDays(last, 1)),
                chunk_minutes: chunk,
                include_google: google,
                ...(useSaved
                  ? { use_saved_availability: true }
                  : {
                      day_start_minutes: begin,
                      day_end_minutes: end,
                      weekdays,
                    }),
                ...(replace ? { replace_existing: true } : {}),
              }),
            });
            if (active.current) {
              setPlan(result);
              setIgnoreRestored(true);
            }
          } catch (err) {
            if (active.current) setError(errorMessage(err));
          } finally {
            pending.current = false;
            if (active.current) setBusy(false);
          }
        }}
      >
        <fieldset className="planning-steps" disabled={busy}>
          <div className="planning-step">
            <h2>1. 할 일 선택</h2>
            <div
              className="planning-modes"
              role="group"
              aria-label="시간 추천 방식"
            >
              {[false, true].map((value) => (
                <button
                  key={String(value)}
                  type="button"
                  className="secondary"
                  aria-pressed={replace === value}
                  onClick={() => {
                    if (replace === value) return;
                    setReplace(value);
                    setSelection([]);
                    setPlan(null);
                    setIgnoreRestored(true);
                    setError("");
                  }}
                >
                  {value ? "저장한 시간 다시 정하기" : "시간 미정 할 일"}
                </button>
              ))}
            </div>
            <p className="small muted">
              {replace
                ? "아직 시작하지 않은 일정은 시간을 다시 정할 수 있습니다. 새 시간을 저장하면 기존 시간이 바뀝니다."
                : "목록에서 시간을 정할 할 일을 골라주세요."}
            </p>
            {selection === null &&
              (initialTaskId || retryPlan) &&
              (seeds.loading || (retryPlan && restore.loading) ? (
                <Loading />
              ) : seeds.error ? (
                <ErrorNotice message={seeds.error} retry={seeds.reload} />
              ) : (initialTaskId
                  ? 1
                  : retryIds
                    ? retryIds.split(",").length
                    : 0) > selected.length ? (
                <p className="notice">
                  일부 할 일의 시간을 추천받을 수 없어요. 아래 목록에서 할 일을
                  선택해 주세요.
                </p>
              ) : null)}
            <PlanningTaskPicker
              key={String(replace)}
              replaceExisting={replace}
              selected={selected}
              onChange={(tasks) => {
                setSelection(tasks);
                setPlan(null);
                setIgnoreRestored(true);
                setError("");
              }}
            />
          </div>
          <div className="planning-step planning-options">
            <h2>2. 추천 조건 확인</h2>
            <details
              ref={conditions}
              className="planning-conditions"
              onChangeCapture={() => {
                setPlan(null);
                setIgnoreRestored(true);
                setError("");
              }}
              onInvalidCapture={(e) => {
                e.currentTarget.open = true;
              }}
            >
              <summary ref={conditionsSummary}>
                <span className="planning-conditions-title">추천 조건</span>
                <span className="planning-conditions-action">
                  추천 조건 변경
                </span>
                <span className="planning-conditions-values small muted">
                  <span>
                    {first && last
                      ? `${first} ~ ${last}`
                      : "추천 기간을 입력해 주세요"}
                  </span>
                  <span>
                    {useSaved
                      ? describeHours(availability.data)
                      : `${weekdayLabel} ${clock(begin)}~${clock(end)}`}
                  </span>
                  {useSaved &&
                    Boolean(availability.data?.exceptions.length) && (
                      <span>
                        예외 날짜 {availability.data?.exceptions.length}일 반영
                      </span>
                    )}
                  <span>한 번에 최대 {chunk}분</span>
                  <span>플랜캐치 일정 피하기</span>
                  <span>
                    {!google
                      ? "Google 일정 제외"
                      : connection.data?.reconnect_required
                        ? "Google 재연결 필요"
                        : connection.data?.connected
                          ? "Google 바쁨 일정도 확인"
                          : connection.data
                            ? "Google 미연결"
                            : "연결된 Google 일정도 확인"}
                  </span>
                </span>
              </summary>
              <div className="planning-conditions-fields">
                <p>
                  <Link href="/planning/availability">가능 시간 설정</Link>
                </p>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={useSaved}
                    onChange={(e) => setUseSaved(e.target.checked)}
                  />
                  저장한 가능 시간과 날짜별 예외 사용
                </label>
                {useSaved && (
                  <p className="small muted">
                    계정에 저장한 시간과 날짜별 예외를 반영합니다. 처음에는 평일
                    09:00~18:00입니다.
                  </p>
                )}
                <div className="form-grid">
                  <label>
                    추천 기간 시작일
                    <input
                      type="date"
                      required
                      value={first}
                      onChange={(e) => setFirst(e.target.value)}
                    />
                  </label>
                  <label>
                    추천 기간 종료일
                    <input
                      type="date"
                      required
                      min={first}
                      value={last}
                      onChange={(e) => setLast(e.target.value)}
                    />
                  </label>
                  <label>
                    하루 작업 시작
                    <select
                      value={begin}
                      disabled={useSaved}
                      onChange={(e) => setBegin(Number(e.target.value))}
                    >
                      {Array.from({ length: 48 }, (_, i) => i * 30).map((m) => (
                        <option key={m} value={m}>
                          {clock(m)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    하루 작업 종료
                    <select
                      value={end}
                      disabled={useSaved}
                      onChange={(e) => setEnd(Number(e.target.value))}
                    >
                      {Array.from({ length: 48 }, (_, i) => (i + 1) * 30).map(
                        (m) => (
                          <option key={m} value={m}>
                            {clock(m)}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                </div>
                <div
                  role="group"
                  aria-label="작업할 요일"
                  className="planning-days"
                >
                  {days.map((day, i) => (
                    <label key={day} className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={weekdays.includes(i)}
                        disabled={useSaved}
                        onChange={(e) =>
                          setWeekdays((current) =>
                            e.target.checked
                              ? [...current, i]
                              : current.filter((d) => d !== i),
                          )
                        }
                      />
                      {day}
                    </label>
                  ))}
                </div>
                <label>
                  한 번에 작업할 시간
                  <select
                    value={chunk}
                    onChange={(e) => setChunk(Number(e.target.value))}
                  >
                    {[15, 30, 60, 90, 120, 180, 240].map((m) => (
                      <option key={m} value={m}>
                        {m}분 이내
                      </option>
                    ))}
                  </select>
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={google}
                    onChange={(e) => setGoogle(e.target.checked)}
                  />
                  연결된 구글 기본 캘린더의 바쁨 일정도 피하기
                </label>
                <p className="small muted">
                  한국 시간 기준으로 최대 31일을 선택할 수 있습니다. 안전
                  마감일이 있으면 그 전에 끝내도록 제안합니다.
                </p>
              </div>
            </details>
            <h2>3. 추천 시간 찾기</h2>
            {error && <ErrorNotice message={error} />}
            <div className="planning-preview-actions form-actions">
              <p className="small muted" role="status">
                {busy
                  ? "가능 시간과 기존 일정을 비교하고 있어요."
                  : selected.length
                    ? "할 일 " + selected.length + "개의 시간을 확인합니다."
                    : "할 일을 선택하면 추천받을 수 있어요."}
              </p>
              <button
                className={shown ? "secondary" : undefined}
                disabled={!selected.length || selected.length > 20}
              >
                {busy
                  ? "빈 시간을 확인하는 중…"
                  : replace
                    ? "새 시간 추천 보기"
                    : "추천 시간 보기"}
              </button>
            </div>
          </div>
        </fieldset>
      </form>
      {!ignoreRestored && restore.error && (
        <ErrorNotice message={restore.error} retry={restore.reload} />
      )}
      {shown && (
        <PlanEditor
          key={shown.id}
          plan={shown}
          headingRef={previewHeading}
          onApproved={setPlan}
          onEditConditions={() => {
            if (conditions.current) conditions.current.open = true;
            conditionsSummary.current?.focus();
          }}
          onReplan={() => {
            setReplace(true);
            setSelection([]);
            setPlan(null);
            setIgnoreRestored(true);
            setError("");
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      )}
    </div>
  );
}

function PlanEditor({
  plan,
  headingRef,
  onApproved,
  onEditConditions,
  onReplan,
}: {
  plan: Plan;
  headingRef: Ref<HTMLHeadingElement>;
  onApproved: (plan: Plan) => void;
  onEditConditions: () => void;
  onReplan: () => void;
}) {
  const [draft, setDraft] = useState(() =>
    plan.blocks.map((b) => ({ ...b, local: toSeoulInput(b.start_at) })),
  );
  const displayedBlocks = plan.approved_at
    ? plan.blocks.map((block) => ({
        ...block,
        local: toSeoulInput(block.start_at),
      }))
    : draft;
  const groups = Array.from(new Set(plan.blocks.map((b) => b.task_id)));
  const [selected, setSelected] = useState(groups);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [managing, setManaging] = useState("");
  const manage = useResource(
    useCallback(
      () => (managing ? tasksApi.get(managing) : Promise.resolve(null)),
      [managing],
    ),
  );
  const pending = useRef(false);
  const [moment, setMoment] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setMoment(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const expired = !plan.approved_at && Date.parse(plan.expires_at) <= moment;
  const edits = JSON.stringify([draft, selected]);
  const { markSaved } = useUnsavedChanges(edits);
  return (
    <section className="card planning-result" aria-label="추천 시간 미리보기">
      <h2 ref={headingRef} tabIndex={-1}>
        {plan.approved_at
          ? "캘린더 저장 완료"
          : expired
            ? "유효 시간이 지난 미리보기"
            : "추천 시간 확인"}
      </h2>
      <p className="small muted">
        {toSeoulInput(plan.request.start_at).slice(0, 10)} ~{" "}
        {addDays(toSeoulInput(plan.request.end_at).slice(0, 10), -1)} · 한국
        시간 ·{" "}
        {plan.details.google_state === "checked"
          ? "Google 바쁨 일정 확인"
          : plan.details.google_state === "not_connected"
            ? "Google 미연결"
            : !plan.request.include_google
              ? "Google 일정 제외"
              : "Google 일정 확인 필요"}
      </p>
      {plan.details.warnings.map((message, i) => (
        <p key={i} className="notice">
          {message}
        </p>
      ))}
      {plan.details.replace_existing && (
        <section className="planning-replacement" aria-label="기존 시간과 비교">
          <h3>{plan.approved_at ? "변경 전 시간 기록" : "변경할 기존 시간"}</h3>
          <p className="small muted">
            {plan.approved_at
              ? "선택한 할 일의 시간을 변경했습니다."
              : "선택한 할 일의 시간을 저장하면 아래 시간이 바뀝니다. 제외했거나 추천 시간이 없는 할 일은 기존 시간을 유지합니다."}
          </p>
          <ul>
            {plan.details.replaced_blocks?.map((block) => (
              <li key={block.id}>
                <strong>{block.title}</strong> · {formatSeoul(block.start_at)} ~{" "}
                {formatSeoul(block.end_at)}
                {!plan.approved_at &&
                  !selected.includes(block.task_id) &&
                  " · 기존 시간 유지"}
              </li>
            ))}
          </ul>
          {!plan.approved_at && (
            <p className="notice">
              일부 할 일을 제외하면 그 할 일의 기존 시간과 겹칠 수 있습니다.
              저장할 수 없다면 할 일을 다시 선택하고 추천 시간을 확인하세요.
            </p>
          )}
        </section>
      )}
      {plan.approved_at ? (
        <>
          <p className="success" role="status">
            캘린더에 시간 {plan.blocks.length}개를 저장했습니다. 구글 계정이
            연결되어 있으면 자동 반영됩니다.
          </p>
          <p className="small muted">
            아래는 처음 저장한 시간입니다. 이후 변경·삭제된 실제 시간은 ‘저장한
            시간 관리’에서 확인하세요.
          </p>
          <Link className="button" href="/calendar">
            캘린더 보기
          </Link>
          <button type="button" className="secondary" onClick={onReplan}>
            시간 다시 정하기
          </button>
        </>
      ) : (
        <p className="notice">
          아직 캘린더에는 저장되지 않았습니다. 필요한 경우 시작 시간을 바꾸거나
          할 일을 제외한 뒤 저장하세요.
        </p>
      )}
      {expired && (
        <p className="notice">
          이 미리보기는 유효 시간이 지나 조회만 가능합니다. 새 미리보기를 만들어
          주세요.
        </p>
      )}
      {!plan.blocks.length && (
        <p>
          현재 조건에 맞는 시간이 없습니다. 추천 기간을 늘리거나 작업 가능한
          시간을 변경해 보세요.
        </p>
      )}
      {!plan.approved_at && (
        <button type="button" className="secondary" onClick={onEditConditions}>
          추천 조건 수정
        </button>
      )}
      {groups.map((id) => {
        const task = plan.details.tasks.find((t) => t.id === id)!;
        const blocks = displayedBlocks.filter((block) => block.task_id === id);
        const included = Boolean(plan.approved_at) || selected.includes(id);
        return (
          <div key={id} className="planning-task-blocks">
            {plan.approved_at ? (
              <h3>{task.title}</h3>
            ) : (
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={selected.includes(id)}
                  disabled={busy || expired}
                  onChange={(e) =>
                    setSelected((ids) =>
                      e.target.checked
                        ? [...ids, id]
                        : ids.filter((value) => value !== id),
                    )
                  }
                />
                <strong>{task.title} 추천 시간 포함</strong>
              </label>
            )}
            <p className="small muted">
              {task.minutes}분 ·{" "}
              {task.uses_safety_deadline ? "안전 마감 기준" : "추천 완료 기준"}:{" "}
              {formatSeoul(task.limit)}
              {blocks.length > 1 && " · " + blocks.length + "회로 나누어 진행"}
            </p>
            <div className="planning-time-cards">
              {blocks.map((block, index) => {
                const ms =
                  Date.parse(block.end_at) - Date.parse(block.start_at);
                const original = toSeoulInput(block.start_at);
                const endAt = endOfWork(block.local, ms);
                const localEnd = endAt ? toSeoulInput(endAt) : "";
                const checked =
                  block.local === original && !expired && !plan.details.blocked;
                return (
                  <article
                    key={block.id}
                    className="planning-time-card"
                    data-included={included}
                  >
                    <div className="planning-time-meta">
                      <strong>
                        {block.local && localEnd
                          ? dayLabel(block.local.slice(0, 10))
                          : "시작 시간 입력 필요"}
                      </strong>
                      <span className="tag">
                        {plan.approved_at
                          ? "저장됨"
                          : included
                            ? "저장에 포함"
                            : "저장에서 제외"}
                      </span>
                    </div>
                    <p className="planning-time-range">
                      {block.local && localEnd
                        ? block.local.slice(11) +
                          " ~ " +
                          (block.local.slice(0, 10) !== localEnd.slice(0, 10)
                            ? localEnd.slice(0, 10) + " "
                            : "") +
                          localEnd.slice(11)
                        : "시간 미정"}
                      <span className="small muted">
                        {" "}
                        · {Math.round(ms / 60_000)}분
                      </span>
                    </p>
                    {!plan.approved_at && !expired && (
                      <p className="small muted">
                        {checked
                          ? plan.details.google_state === "checked"
                            ? "가능 시간 안에서 플랜캐치와 Google의 바쁜 일정을 피한 시간입니다."
                            : "가능 시간 안에서 플랜캐치 일정과 겹치지 않는 시간입니다."
                          : "저장할 때 변경한 시간과 일정 겹침을 다시 확인합니다."}
                      </p>
                    )}
                    {!plan.approved_at && !expired && (
                      <details>
                        <summary>시간 수정</summary>
                        <div className="form-grid planning-block">
                          <label>
                            {task.title} {index + 1} 시작
                            <input
                              type="datetime-local"
                              value={block.local}
                              disabled={
                                busy ||
                                Boolean(plan.approved_at) ||
                                expired ||
                                !selected.includes(id)
                              }
                              onChange={(e) => {
                                setError("");
                                setDraft((current) =>
                                  current.map((b) =>
                                    b.id === block.id
                                      ? { ...b, local: e.target.value }
                                      : b,
                                  ),
                                );
                              }}
                            />
                          </label>
                          <label>
                            종료 (소요시간 유지)
                            <input
                              type="text"
                              readOnly
                              value={(() => {
                                try {
                                  return formatSeoul(
                                    new Date(
                                      Date.parse(seoulInputToUtc(block.local)) +
                                        (Date.parse(block.end_at) -
                                          Date.parse(block.start_at)),
                                    ).toISOString(),
                                  );
                                } catch {
                                  return "시작 시간을 입력해 주세요.";
                                }
                              })()}
                            />
                          </label>
                        </div>
                      </details>
                    )}
                  </article>
                );
              })}
            </div>
          </div>
        );
      })}
      {!plan.approved_at && (
        <>
          <p className="small muted">
            미리보기 만료: {formatSeoul(plan.expires_at)}
          </p>
          {error && <ErrorNotice message={error} />}
          <div className="form-actions">
            <button
              disabled={
                busy || expired || plan.details.blocked || !selected.length
              }
              onClick={async () => {
                if (pending.current) return;
                pending.current = true;
                setBusy(true);
                setError("");
                try {
                  const blocks = draft
                    .filter((b) => selected.includes(b.task_id))
                    .map((b) => {
                      if (!b.local)
                        throw new Error("시작 시간을 모두 입력해 주세요.");
                      const start = seoulInputToUtc(b.local);
                      return {
                        id: b.id,
                        start_at: start,
                        end_at: new Date(
                          Date.parse(start) +
                            Date.parse(b.end_at) -
                            Date.parse(b.start_at),
                        ).toISOString(),
                      };
                    });
                  const saved = await api<Plan>(
                    `/api/scheduling/plans/${encodeURIComponent(plan.id)}/approve`,
                    { method: "POST", body: JSON.stringify({ blocks }) },
                  );
                  markSaved();
                  onApproved(saved);
                } catch (err) {
                  setError(
                    `${errorMessage(err)} 같은 미리보기를 다시 승인해도 중복 저장하지 않습니다.`,
                  );
                } finally {
                  pending.current = false;
                  setBusy(false);
                }
              }}
            >
              {busy
                ? "다시 확인하고 저장하는 중…"
                : plan.details.replace_existing
                  ? "선택한 시간으로 변경"
                  : "캘린더에 저장"}
            </button>
          </div>
        </>
      )}
      {plan.details.unplaced.length > 0 && (
        <div className="planning-unplaced">
          <h3>추천 시간을 찾지 못한 할 일</h3>
          <ul>
            {plan.details.unplaced.map((t) => (
              <li key={t.task_id}>
                <Link href={`/tasks/${encodeURIComponent(t.task_id)}`}>
                  {t.title}
                </Link>{" "}
                — {t.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="small">
        <Link href="/planning/history">전체 시간 추천 기록 →</Link>
        {" · "}
        <Link href={`/planning?${new URLSearchParams({ plan: plan.id })}`}>
          이 미리보기 다시 열기 →
        </Link>
      </p>
      {plan.approved_at && (
        <div>
          <h3>저장한 시간 관리</h3>
          <p className="small muted">
            할 일은 그대로 두고 캘린더에 잡힌 시간만 바꾸거나 삭제할 수
            있습니다.
          </p>
          <label>
            관리할 할 일
            <select
              value={managing}
              aria-label="관리할 할 일"
              onChange={(e) => setManaging(e.target.value)}
            >
              <option value="">선택해 주세요</option>
              {groups.map((id) => (
                <option key={id} value={id}>
                  {plan.details.tasks.find((t) => t.id === id)?.title}
                </option>
              ))}
            </select>
          </label>
          {manage.loading && managing ? (
            <Loading />
          ) : manage.error ? (
            <ErrorNotice message={manage.error} retry={manage.reload} />
          ) : manage.data ? (
            <TaskPlacements key={manage.data.id} task={manage.data} />
          ) : null}
        </div>
      )}
    </section>
  );
}
