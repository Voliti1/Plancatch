"use client";
import { useScheduleTime } from "@/features/settings/time-zone";
import { useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ErrorNotice, Loading } from "@/components/feedback";
import { errorMessage } from "@/lib/api/client";
import { useResource } from "@/lib/api/use-resource";
import { localInput, zonedInputToUtc } from "@/lib/date/time-zones";
import { useHydrated } from "@/lib/use-hydrated";
import { useUnsavedChanges } from "@/lib/unsaved-changes";
import {
  OverlapWarning,
  OverlapScope,
  useOverlapCheck,
} from "@/features/calendar/overlap-warning";
import {
  RecurrenceSettings,
  validateRecurrence,
  type Recurrence,
} from "./recurrence-settings";
import type { ScheduleType, Task, TaskInput } from "@/types/task";
import type { DeadlineInput } from "@/types/api";
import type { NaturalScheduleDraft } from "@/types/natural-schedule";
import { loadDeadlineOptions } from "./deadline-options";
import "./calendar-task-form.css";
import {
  ReminderSettings,
  validateReminders,
} from "@/features/google-calendar/reminder-settings";
import {
  newReminderSettings,
  type GoogleReminderSettings,
} from "@/types/google-reminders";

const DEFAULT_TASK_MINUTES = 60;
const MAX_ESTIMATED_MINUTES = 2147483647;
const priorityNames = ["매우 낮음", "낮음", "보통", "높음", "매우 높음"];
const invalidTimeRange = "종료 일시는 시작 일시보다 늦게 설정해 주세요.";

function optionalUtc(
  value: string,
  original: string | null,
  zone: string,
): string | null {
  if (!value) return null;
  // Preserve server seconds/milliseconds when only another field is edited.
  return original && value === localInput(original, zone)
    ? original
    : zonedInputToUtc(value, zone);
}

export function TaskForm({
  initial,
  draft,
  deadlineId,
  onSave,
  onSaveDeadline,
  onCancel,
  submitLabel = "작업 등록",
  disabled = false,
  submitDisabled = false,
  onUserEdit,
  cancelPreservesInput = false,
  reminderNotice,
  variant = "task",
  initialScheduleType,
}: {
  initial?: Task;
  draft?: NaturalScheduleDraft;
  deadlineId?: string;
  onSave: (payload: TaskInput) => Promise<void>;
  onSaveDeadline?: (payload: DeadlineInput) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
  disabled?: boolean;
  submitDisabled?: boolean;
  onUserEdit?: () => void;
  cancelPreservesInput?: boolean;
  reminderNotice?: ReactNode;
  variant?: "task" | "calendar";
  initialScheduleType?: ScheduleType;
}) {
  const { toLocalInput, fromLocalInput, zoneLabel, zone } = useScheduleTime();
  const simple = variant === "calendar";
  const singleOccurrence = Boolean(initial?.series_id);
  const [resetOccurrences, setResetOccurrences] = useState(false);
  const [registrationKind, setRegistrationKind] = useState<"task" | "deadline">(
    draft?.kind ?? "task",
  );
  const canChooseKind = simple && !initial && Boolean(onSaveDeadline);
  const isDeadline = canChooseKind && registrationKind === "deadline";
  const titleLabelId = useId();
  const timeHelpId = useId();
  const timeErrorId = useId();
  const hydrated = useHydrated();
  const descriptionId = useId();
  const deadlineLabelId = useId();
  const priorityLabelId = useId();
  const typeLabelId = useId();
  const options = useResource(loadDeadlineOptions);
  const [title, setTitle] = useState(initial?.title ?? draft?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [recurrence, setRecurrence] = useState<Recurrence | null>(
    initial?.recurrence ?? draft?.recurrence ?? null,
  );
  const [deadline, setDeadline] = useState(
    initial?.deadline_id ?? deadlineId ?? "",
  );
  const [minutes, setMinutes] = useState(
    initial?.estimated_minutes?.toString() ?? "",
  );
  const [priority, setPriority] = useState(initial?.priority ?? 3);
  const [scheduleType, setScheduleType] = useState<ScheduleType>(
    initial?.schedule_type ??
      initialScheduleType ??
      (simple ? "fixed" : "flexible"),
  );
  const withoutTime =
    canChooseKind && !isDeadline && scheduleType === "flexible";
  const [possibleStart, setPossibleStart] = useState("");
  const [possibleEnd, setPossibleEnd] = useState("");
  const requireTimes =
    simple && scheduleType === "fixed" && (!initial || singleOccurrence);
  const [start, setStart] = useState(
    initial?.earliest_start || draft?.start_at
      ? toLocalInput((initial?.earliest_start ?? draft?.start_at)!)
      : "",
  );
  const [end, setEnd] = useState(
    initial?.latest_end || draft?.end_at
      ? toLocalInput((initial?.latest_end ?? draft?.end_at)!)
      : "",
  );
  const [completed, setCompleted] = useState(initial?.is_completed ?? false);
  const [reminders, setReminders] = useState<GoogleReminderSettings | null>(
    initial ? (initial.google_reminders ?? null) : newReminderSettings(),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endTooEarly =
    canChooseKind &&
    !isDeadline &&
    !withoutTime &&
    Boolean(start && end && end < start);
  const submitting = useRef(false);
  const overlap = useOverlapCheck();
  const { markSaved, confirmDiscard } = useUnsavedChanges(
    JSON.stringify([
      registrationKind,
      title,
      description,
      deadline,
      minutes,
      priority,
      scheduleType,
      possibleStart,
      possibleEnd,
      start,
      end,
      completed,
      reminders,
      recurrence,
      resetOccurrences,
    ]),
  );
  function cancel() {
    if (cancelPreservesInput || confirmDiscard()) onCancel();
  }

  function updateTaskEnd(startValue: string, minutesValue: string) {
    if (!simple || isDeadline || !startValue) return;
    const duration =
      minutesValue === "" ? DEFAULT_TASK_MINUTES : Number(minutesValue);
    if (
      !Number.isInteger(duration) ||
      duration < 1 ||
      duration > MAX_ESTIMATED_MINUTES
    )
      return;
    // Calculate on the displayed Seoul clock, regardless of the browser's zone.
    let startTime: number;
    try {
      startTime = Date.parse(fromLocalInput(startValue));
    } catch {
      return;
    }
    const endTime = new Date(startTime + duration * 60_000);
    if (endTime.getUTCFullYear() >= 1 && endTime.getUTCFullYear() <= 9999)
      setEnd(toLocalInput(endTime.toISOString()));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || submitDisabled) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      validateReminders(reminders);
      if (!title.trim())
        throw new Error(
          simple ? "일정명을 입력해 주세요." : "작업명을 입력해 주세요.",
        );
      if (isDeadline && onSaveDeadline) {
        if (!end) throw new Error("마감 일시를 입력해 주세요.");
        await onSaveDeadline({
          ...(reminders ? { google_reminders: reminders } : {}),
          title: title.trim(),
          due_at: fromLocalInput(end),
          description: description.trim() || null,
          source_id: null,
          deadline_type: null,
          safety_buffer_minutes: null,
          is_confirmed: true,
        });
        markSaved();
        return;
      }
      if (requireTimes && (!start || !end))
        throw new Error("시작 일시와 종료 일시를 입력해 주세요.");
      if (scheduleType === "fixed") validateRecurrence(recurrence, start, end);
      if (scheduleType === "fixed" && recurrence?.until === "")
        throw new Error("반복 종료일을 선택해 주세요.");
      const estimated = minutes === "" ? null : Number(minutes);
      if (withoutTime && estimated === null)
        throw new Error("시간 미정 할 일의 예상 소요시간을 입력해 주세요.");
      if (
        estimated !== null &&
        (!Number.isInteger(estimated) ||
          estimated <= 0 ||
          estimated > MAX_ESTIMATED_MINUTES)
      )
        throw new Error("예상 소요시간은 1분 이상의 정수로 입력해 주세요.");
      if (deadline && !options.data?.some((item) => item.id === deadline))
        throw new Error(
          "연결할 마감일을 다시 선택하거나 연결 안 함을 선택해 주세요.",
        );
      const earliest = withoutTime
        ? optionalUtc(possibleStart, null, zone)
        : optionalUtc(
            start,
            initial?.earliest_start ?? draft?.start_at ?? null,
            zone,
          );
      const latest = withoutTime
        ? optionalUtc(possibleEnd, null, zone)
        : optionalUtc(end, initial?.latest_end ?? draft?.end_at ?? null, zone);
      if (earliest && latest && new Date(earliest) >= new Date(latest))
        throw new Error(
          simple
            ? invalidTimeRange
            : "최종 완료 일시는 가능 시작 일시보다 늦어야 합니다.",
        );
      const checkTimes =
        !initial ||
        initial.schedule_type !== scheduleType ||
        Date.parse(initial.earliest_start ?? "") !==
          Date.parse(earliest ?? "") ||
        Date.parse(initial.latest_end ?? "") !== Date.parse(latest ?? "") ||
        JSON.stringify(initial.recurrence ?? null) !==
          JSON.stringify(recurrence ?? null);
      if (
        scheduleType === "fixed" &&
        earliest &&
        latest &&
        checkTimes &&
        !(await overlap.check({
          start_at: earliest,
          end_at: latest,
          recurrence,
          ...(initial
            ? singleOccurrence &&
              initial.id === initial.series_id &&
              initial.original_start
              ? {
                  exclude_occurrence_task_id: initial.series_id,
                  exclude_occurrence_start: initial.original_start,
                }
              : { exclude_task_id: initial.id }
            : {}),
        }))
      )
        return;
      await onSave({
        ...(initial?.exception_count
          ? { reset_occurrences: resetOccurrences }
          : {}),
        ...(recurrence || initial?.recurrence
          ? { recurrence: scheduleType === "fixed" ? recurrence : null }
          : {}),
        ...(reminders ? { google_reminders: reminders } : {}),
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
      markSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  const durationAndPriority = (
    <div className="form-grid">
      <label>
        {withoutTime ? "예상 소요시간 (분, 필수)" : "예상 소요시간 (분, 선택)"}
        <input
          name="estimated_minutes"
          type="number"
          min={1}
          max={MAX_ESTIMATED_MINUTES}
          step={1}
          required={withoutTime}
          inputMode={canChooseKind ? "numeric" : undefined}
          value={minutes}
          onChange={(event) => {
            const value = event.target.value;
            setMinutes(value);
            if (!event.target.validity.badInput) updateTaskEnd(start, value);
          }}
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
              {canChooseKind ? priorityNames[value - 1] : value}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
  const deadlineField = (
    <label>
      <span id={deadlineLabelId}>연결할 마감일</span>
      <select
        name="deadline_id"
        aria-labelledby={deadlineLabelId}
        value={deadline}
        onChange={(event) => setDeadline(event.target.value)}
      >
        <option value="">연결 안 함</option>
        {deadline && !options.data?.some((item) => item.id === deadline) && (
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
  );
  const settings = (
    <>
      {!withoutTime && deadlineField}
      {!simple && durationAndPriority}
      {!canChooseKind && (
        <label>
          <span id={typeLabelId}>작업 유형</span>
          <select
            name="schedule_type"
            aria-labelledby={typeLabelId}
            value={scheduleType}
            disabled={singleOccurrence}
            onChange={(event) =>
              setScheduleType(event.target.value as ScheduleType)
            }
          >
            <option value="flexible">유동 작업</option>
            <option value="fixed">고정 일정</option>
          </select>
        </label>
      )}
    </>
  );
  const times = (
    <div className={`form-grid ${isDeadline ? "manual-deadline-time" : ""}`}>
      {!isDeadline && (
        <label>
          {simple ? "시작 일시" : `가능 시작 일시 (${zoneLabel}, 선택)`}
          <input
            name="earliest_start"
            type="datetime-local"
            value={start}
            onChange={(event) => {
              const value = event.target.value;
              setStart(value);
              updateTaskEnd(value, minutes);
            }}
            required={requireTimes}
            aria-describedby={canChooseKind ? timeHelpId : undefined}
          />
        </label>
      )}
      <label>
        {isDeadline
          ? "마감 일시"
          : simple
            ? "종료 일시"
            : `최종 완료 일시 (${zoneLabel}, 선택)`}
        <input
          name="latest_end"
          type="datetime-local"
          value={end}
          onChange={(event) => setEnd(event.target.value)}
          required={requireTimes}
          aria-invalid={endTooEarly || undefined}
          aria-describedby={
            canChooseKind
              ? `${timeHelpId}${endTooEarly ? ` ${timeErrorId}` : ""}`
              : undefined
          }
        />
      </label>
    </div>
  );
  const descriptionField = (
    <label>
      <span id={descriptionId}>
        {simple ? "메모 (선택)" : "작업 설명 (선택)"}
      </span>
      <textarea
        name="description"
        aria-labelledby={descriptionId}
        rows={simple ? 2 : 4}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder={simple ? "장소나 준비물 등을 적어보세요." : undefined}
      />
    </label>
  );
  const completion = (
    <label className="checkbox">
      <input
        type="checkbox"
        name="is_completed"
        checked={completed}
        onChange={(event) => setCompleted(event.target.checked)}
      />
      완료한 작업으로 표시
    </label>
  );

  return (
    <form
      className={simple ? "calendar-task-form" : undefined}
      onSubmit={submit}
      onChangeCapture={() => {
        overlap.clear();
        onUserEdit?.();
      }}
      noValidate={simple}
    >
      {canChooseKind && (
        <div className="registration-kind-field">
          <h3>일정 유형</h3>
          <div
            className="manual-registration-kind"
            role="group"
            aria-label="등록 종류"
          >
            <button
              type="button"
              className={registrationKind === "task" ? "selected" : "secondary"}
              aria-pressed={registrationKind === "task"}
              disabled={disabled || busy || !hydrated}
              onClick={() => {
                onUserEdit?.();
                setRegistrationKind("task");
                setError("");
              }}
            >
              할 일
            </button>
            <button
              type="button"
              className={
                registrationKind === "deadline" ? "selected" : "secondary"
              }
              aria-pressed={registrationKind === "deadline"}
              disabled={disabled || busy || !hydrated}
              onClick={() => {
                onUserEdit?.();
                setRegistrationKind("deadline");
                setError("");
              }}
            >
              마감일
            </button>
          </div>
          <p className="small muted">
            {isDeadline
              ? "제출이나 신청처럼 기한이 있는 일정이에요."
              : "시간을 직접 정하거나 나중에 추천받을 수 있어요."}
          </p>
        </div>
      )}
      {!isDeadline && options.loading && <Loading />}
      {!isDeadline && options.error && (
        <ErrorNotice
          message={`마감일 목록을 불러오지 못했습니다. ${options.error}`}
          retry={options.reload}
        />
      )}
      <fieldset
        disabled={
          disabled ||
          busy ||
          !hydrated ||
          (!isDeadline && (options.loading || Boolean(options.error)))
        }
      >
        <label>
          <span className={canChooseKind ? "registration-label" : undefined}>
            <span id={titleLabelId}>{simple ? "일정명" : "작업명"}</span>
            {canChooseKind && (
              <span className="registration-required" aria-hidden="true">
                필수
              </span>
            )}
          </span>
          <input
            name="title"
            aria-labelledby={titleLabelId}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            maxLength={255}
            placeholder={
              isDeadline
                ? "예: 프로젝트 보고서 제출"
                : simple
                  ? "예: 팀 프로젝트 회의"
                  : "예: 발표 자료 초안 작성"
            }
          />
        </label>
        {simple ? (
          <>
            {canChooseKind && !isDeadline && (
              <div className="registration-kind-field">
                <h3>시간 지정</h3>
                <div
                  className="manual-registration-kind"
                  role="group"
                  aria-label="할 일 시간 지정"
                >
                  {(
                    [
                      ["fixed", "직접 시간 지정"],
                      ["flexible", "시간 미정으로 등록"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={
                        scheduleType === value ? "selected" : "secondary"
                      }
                      aria-pressed={scheduleType === value}
                      onClick={() => {
                        setScheduleType(value);
                        setError("");
                        overlap.clear();
                        onUserEdit?.();
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {canChooseKind && !withoutTime && (
              <div className="registration-time-heading">
                <div className="registration-label">
                  <h3>{isDeadline ? "마감 시간" : "일정 시간"}</h3>
                  <span className="registration-required" aria-hidden="true">
                    필수
                  </span>
                </div>
                <p id={timeHelpId} className="small muted">
                  {zoneLabel} 기준
                </p>
              </div>
            )}
            {!withoutTime && times}
            {endTooEarly && (
              <p
                id={timeErrorId}
                role="alert"
                className="registration-time-error"
              >
                {invalidTimeRange}
              </p>
            )}
            {!canChooseKind && (
              <p className="muted small calendar-task-timezone">
                {zoneLabel} 기준
                {initial ? " · 시간은 비워 둘 수 있습니다." : ""}
              </p>
            )}
            {!isDeadline && durationAndPriority}
            {withoutTime && deadlineField}
            {canChooseKind && (
              <h3 className="registration-extras-heading">추가 설정</h3>
            )}
            {descriptionField}
            {!isDeadline && (
              <details className="calendar-task-settings">
                <summary>상세 설정</summary>
                <div>
                  {settings}
                  {withoutTime && (
                    <div className="form-grid">
                      <label>
                        가능 시작 일시 (선택)
                        <input
                          type="datetime-local"
                          value={possibleStart}
                          onChange={(event) =>
                            setPossibleStart(event.target.value)
                          }
                        />
                      </label>
                      <label>
                        가능 종료 일시 (선택)
                        <input
                          type="datetime-local"
                          value={possibleEnd}
                          onChange={(event) =>
                            setPossibleEnd(event.target.value)
                          }
                        />
                      </label>
                    </div>
                  )}
                  {completion}
                </div>
              </details>
            )}
          </>
        ) : (
          <>
            {settings}
            {times}
            <p className="muted small">
              가능 기간과 작업 유형을 저장합니다. 고정 일정은 입력한 시작·종료
              시간으로 캘린더에 표시됩니다.
            </p>
            {descriptionField}
            {completion}
          </>
        )}
        {!isDeadline && scheduleType === "fixed" && !singleOccurrence && (
          <RecurrenceSettings
            value={recurrence}
            onChange={(value) => {
              onUserEdit?.();
              setError("");
              setRecurrence(value);
            }}
          />
        )}
        {initial?.recurrence && (
          <p className="notice">변경 사항은 이 반복 일정 전체에 적용됩니다.</p>
        )}
        {!isDeadline && scheduleType === "flexible" && (
          <p className="notice">
            {withoutTime
              ? "저장 후 이 할 일에 맞는 시간을 추천받을 수 있어요."
              : "시작·종료 일시는 작업이 가능한 기간입니다(선택). 소요시간을 입력하면 빈 시간을 추천받을 수 있습니다."}
          </p>
        )}
        {Boolean(initial?.exception_count) && (
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={resetOccurrences}
              onChange={(e) => setResetOccurrences(e.target.checked)}
            />
            개별 변경 초기화 — 시작·종료 시간이나 반복 주기를 바꾸려면
            선택하세요. 개별 수정·삭제를 취소하고 전체 반복 설정으로 되돌립니다.
          </label>
        )}
        <ReminderSettings
          allowPreserve={Boolean(initial) && initial?.google_reminders == null}
          value={reminders}
          registrationKind={canChooseKind ? registrationKind : undefined}
          connectionNotice={reminderNotice}
          onChange={(value) => {
            onUserEdit?.();
            setReminders(value);
          }}
        />
        {!isDeadline && scheduleType === "fixed" && (
          <>
            <OverlapScope />
            <OverlapWarning check={overlap} busy={busy || disabled} />
          </>
        )}
        {error && !(endTooEarly && error === invalidTimeRange) && (
          <ErrorNotice message={error} />
        )}
        <div className="form-actions">
          <button type="button" className="secondary" onClick={cancel}>
            취소
          </button>
          <button type="submit" disabled={submitDisabled}>
            {busy
              ? overlap.checking
                ? "겹침 확인 중…"
                : "저장 중…"
              : initial
                ? "변경 사항 저장"
                : isDeadline
                  ? "마감일 등록"
                  : submitLabel}
          </button>
        </div>
      </fieldset>
      {!isDeadline && options.error && (
        <button type="button" className="secondary" onClick={cancel}>
          돌아가기
        </button>
      )}
    </form>
  );
}
