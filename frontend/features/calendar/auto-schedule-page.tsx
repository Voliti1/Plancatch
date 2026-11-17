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
import { TaskPlacements } from "./task-placements";
import type { SavedState } from "./plan-history";
import { addDays, todaySeoul, utcMidnight } from "./dates";
import { PlanningTaskPicker } from "./planning-task-picker";
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
  request: { start_at: string; end_at: string; include_google: boolean };
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

export function AutoSchedulePage({
  initialPlanId,
  initialReplace = false,
  initialSavedAvailability = true,
}: {
  initialPlanId?: string;
  initialReplace?: boolean;
  initialSavedAvailability?: boolean;
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
  const [selected, setSelected] = useState<string[]>([]);
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
  const shown = plan ?? (!ignoreRestored ? restore.data : null);
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
        eyebrow="AUTOMATIC PLANNING"
        title="자동 배치"
        description="할 일을 고르면 가능한 시간을 추천합니다. 미리보기에서 시간을 확인한 뒤 캘린더에 저장하세요."
        action={
          <div className="planning-heading-actions">
            <Link className="button secondary" href="/planning/availability">
              가능 시간 설정
            </Link>
            <Link className="button secondary" href="/planning/history">
              배치 기록
            </Link>
            <Link className="button secondary" href="/sources/new?mode=manual">
              할 일 등록
            </Link>
          </div>
        }
      />
      <form
        className="card"
        onChangeCapture={() => {
          setPlan(null);
          setIgnoreRestored(true);
          setError("");
        }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (pending.current) return;
          setError("");
          if (!selected.length) {
            setError("배치할 할 일을 선택해 주세요.");
            return;
          }
          pending.current = true;
          setBusy(true);
          try {
            const result = await api<Plan>("/api/scheduling/preview", {
              method: "POST",
              body: JSON.stringify({
                task_ids: selected,
                start_at: utcMidnight(first),
                end_at: utcMidnight(addDays(last, 1)),
                day_start_minutes: begin,
                day_end_minutes: end,
                weekdays,
                chunk_minutes: chunk,
                include_google: google,
                ...(useSaved ? { use_saved_availability: true } : {}),
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
        <fieldset disabled={busy}>
          <h2>배치할 할 일</h2>
          <div className="planning-days" role="group" aria-label="배치 방식">
            {[false, true].map((value) => (
              <button
                key={String(value)}
                type="button"
                className={replace === value ? "" : "secondary"}
                aria-pressed={replace === value}
                onClick={() => {
                  setReplace(value);
                  setSelected([]);
                  setPlan(null);
                  setIgnoreRestored(true);
                  setError("");
                }}
              >
                {value ? "기존 배치 다시 짜기" : "새 배치 만들기"}
              </button>
            ))}
          </div>
          <p className="small muted">
            {replace
              ? "아직 시작하지 않은 배치를 다시 배치할 수 있습니다. 미리보기를 승인하면 기존 시간을 교체합니다."
              : "배치할 수 있는 할 일이 보이지 않으면 유동 작업으로 등록하고 예상 소요시간을 입력하세요."}
          </p>
          <PlanningTaskPicker
            key={String(replace)}
            replaceExisting={replace}
            selected={selected}
            onChange={setSelected}
            onEdit={() => {
              setPlan(null);
              setIgnoreRestored(true);
              setError("");
            }}
          />
          <details
            ref={conditions}
            className="planning-conditions"
            onInvalidCapture={(e) => {
              e.currentTarget.open = true;
            }}
          >
            <summary ref={conditionsSummary}>
              <span className="planning-conditions-title">배치 조건</span>
              <span className="planning-conditions-values small muted">
                <span>
                  {first && last ? `${first} ~ ${last}` : "배치 날짜 입력 필요"}
                </span>
                <span>
                  {useSaved
                    ? "계정의 가능 시간 사용"
                    : `${weekdayLabel} ${clock(begin)}~${clock(end)}`}
                </span>
                <span>한 번에 최대 {chunk}분</span>
                <span>
                  {google ? "Google 바쁨 일정 피하기" : "Google 일정 제외"}
                </span>
              </span>
            </summary>
            <div className="planning-conditions-fields">
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
                  계정에 저장한 시간으로 배치합니다. 아래 하루 시간·요일 대신
                  저장한 설정을 사용합니다. 처음에는 평일 09:00~18:00입니다.
                </p>
              )}
              <div className="form-grid">
                <label>
                  배치 시작일
                  <input
                    type="date"
                    required
                    value={first}
                    onChange={(e) => setFirst(e.target.value)}
                  />
                </label>
                <label>
                  배치 종료일
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
                한국 시간 기준으로 최대 31일을 선택할 수 있습니다. 안전 마감일이
                있으면 그 전에 끝내도록 제안합니다.
              </p>
            </div>
          </details>
          {error && <ErrorNotice message={error} />}
          <div className="form-actions">
            <button disabled={!selected.length || selected.length > 20}>
              {busy
                ? "빈 시간을 확인하는 중…"
                : replace
                  ? "재배치 미리보기 만들기"
                  : "배치 미리보기 만들기"}
            </button>
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
            setSelected([]);
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
  const { markSaved } = useUnsavedChanges(JSON.stringify([draft, selected]));
  return (
    <section className="card planning-result" aria-label="자동 배치 미리보기">
      <h2 ref={headingRef} tabIndex={-1}>
        {plan.approved_at
          ? "배치 저장 완료"
          : expired
            ? "유효 시간이 지난 미리보기"
            : "미리보기 확인"}
      </h2>
      <p className="small muted">
        {formatSeoul(plan.request.start_at)} ~{" "}
        {formatSeoul(plan.request.end_at)} ·{" "}
        {plan.request.include_google
          ? "구글 기본 캘린더 포함 (연결 시)"
          : "구글 일정 제외"}
      </p>
      {plan.details.warnings.map((message, i) => (
        <p key={i} className="notice">
          {message}
        </p>
      ))}
      {plan.details.replace_existing && (
        <section className="planning-replacement" aria-label="재배치 변경 비교">
          <h3>{plan.approved_at ? "교체 전 배치 기록" : "교체할 기존 배치"}</h3>
          <p className="small muted">
            {plan.approved_at
              ? "승인 시 선택한 할 일만 새 배치로 교체했습니다."
              : "아래 기존 시간은 아직 유지됩니다. 선택한 할 일만 승인 시 교체하며, 제외하거나 배치하지 못한 할 일은 기존 시간을 유지합니다."}
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
              승인이 막히면 선택을 다시 정하고 새 미리보기를 만들어 주세요.
            </p>
          )}
        </section>
      )}
      {plan.approved_at ? (
        <>
          <p className="success" role="status">
            승인한 시간 {plan.blocks.length}개를 저장했습니다. 구글 계정이
            연결되어 있으면 자동 반영됩니다.
          </p>
          <p className="small muted">
            아래 시간은 승인 당시 기록입니다. 이후 변경·삭제된 실제 시간은
            ‘저장한 배치 관리’에서 확인하세요.
          </p>
          <Link className="button" href="/calendar">
            캘린더 보기
          </Link>
          <button type="button" className="secondary" onClick={onReplan}>
            다시 배치하기
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
          배치할 수 있는 빈 시간이 없습니다. 아래 제외 이유를 확인하고
          기간·소요시간을 조정해 주세요.
        </p>
      )}
      {!plan.approved_at && (plan.details.blocked || !plan.blocks.length) && (
        <button type="button" className="secondary" onClick={onEditConditions}>
          배치 조건 수정
        </button>
      )}
      {groups.map((id) => {
        const task = plan.details.tasks.find((t) => t.id === id)!;
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
                <strong>{task.title} 배치 포함</strong>
              </label>
            )}
            <p className="small muted">
              {task.minutes}분 ·{" "}
              {task.uses_safety_deadline ? "안전 마감 기준" : "배치 완료 기한"}:{" "}
              {formatSeoul(task.limit)}
            </p>
            {displayedBlocks
              .filter((b) => b.task_id === id)
              .map((block, index) => (
                <div key={block.id} className="form-grid planning-block">
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
              ))}
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
                  ? "선택한 기존 배치 교체"
                  : "캘린더에 저장"}
            </button>
          </div>
        </>
      )}
      {plan.details.unplaced.length > 0 && (
        <div className="planning-unplaced">
          <h3>배치에서 제외된 할 일</h3>
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
        <Link href="/planning/history">전체 배치 기록 →</Link>
        {" · "}
        <Link href={`/planning?${new URLSearchParams({ plan: plan.id })}`}>
          이 미리보기 다시 열기 →
        </Link>
      </p>
      {plan.approved_at && (
        <div>
          <h3>저장한 배치 관리</h3>
          <p className="small muted">
            배치 시간을 수정하거나 지워도 할 일의 내용은 유지됩니다.
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
