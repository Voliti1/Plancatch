import { deadlinesApi } from "@/features/deadlines/api";
import { tasksApi } from "@/features/tasks/api";
import { eventsApi } from "./api";
import type { CalendarRegistration } from "./registrations";
import type { CalendarTarget, TimetableEvent } from "./time-layout";

export function registrationTarget(item: CalendarRegistration): CalendarTarget {
  if (item.kind === "deadline") return { kind: "deadline", id: item.id };
  return {
    kind: "task",
    id: item.series_id ?? item.id,
    occurrence:
      item.original_start ?? (item.is_recurring ? item.start_at : undefined),
  };
}

export function calendarEventKey(event: TimetableEvent) {
  const target = event.target;
  if (!target) return event.id;
  const occurrence = target.kind === "task" ? target.occurrence : undefined;
  return `${target.kind}:${target.id}${occurrence ? `:${new Date(occurrence).toISOString()}` : ""}`;
}

export function canChangeTime(event: TimetableEvent) {
  return Boolean(
    event.target &&
    event.start &&
    !event.cancelled &&
    (event.target.kind !== "placement" || !event.target.locked),
  );
}

export function moveCalendarEvent(
  target: CalendarTarget,
  start: string,
  end: string | null,
) {
  if (target.kind === "deadline")
    return deadlinesApi.update(target.id, { due_at: start });
  if (!end) throw new Error("종료 시간을 확인해 주세요.");
  if (target.kind === "placement") {
    if (target.locked)
      throw new Error("동기화된 배치 시간을 변경할 수 없습니다.");
    return eventsApi.update(target.id, { start_at: start, end_at: end });
  }
  const changed = { earliest_start: start, latest_end: end };
  return target.occurrence
    ? tasksApi.updateOccurrence(target.id, target.occurrence, changed)
    : tasksApi.update(target.id, changed);
}

export function deleteCalendarEvent(target: CalendarTarget) {
  if (target.kind === "deadline") return deadlinesApi.remove(target.id);
  if (target.kind === "placement") {
    if (target.locked) throw new Error("동기화된 배치를 삭제할 수 없습니다.");
    return eventsApi.remove(target.id);
  }
  return target.occurrence
    ? tasksApi.removeOccurrence(target.id, target.occurrence)
    : tasksApi.remove(target.id);
}

function readTask(target: Exclude<CalendarTarget, { kind: "deadline" }>) {
  if (target.kind === "placement") return tasksApi.get(target.taskId);
  return target.occurrence
    ? tasksApi.occurrence(target.id, target.occurrence)
    : tasksApi.get(target.id);
}

export async function readCalendarDescription(target: CalendarTarget) {
  const item =
    target.kind === "deadline"
      ? await deadlinesApi.get(target.id)
      : await readTask(target);
  return item.description;
}

export async function duplicateCalendarEvent(
  target: CalendarTarget,
  event: TimetableEvent,
): Promise<CalendarTarget> {
  if (!event.start) throw new Error("복제할 일정의 시작 시간을 확인해 주세요.");
  if (target.kind === "deadline") {
    const item = await deadlinesApi.get(target.id);
    const copy = await deadlinesApi.create({
      title: item.title,
      due_at: event.start,
      source_id: null,
      safety_buffer_minutes: item.safety_buffer_minutes,
      deadline_type: item.deadline_type,
      description: item.description,
      is_confirmed: item.is_confirmed,
      google_reminders: item.google_reminders ?? undefined,
    });
    return { kind: "deadline", id: copy.id };
  }
  const item = await readTask(target);
  const copy = await tasksApi.create({
    title: item.title,
    description: item.description,
    earliest_start: event.start,
    latest_end: event.end,
    schedule_type: "fixed",
    estimated_minutes:
      target.kind === "placement" && event.end
        ? Math.max(
            1,
            Math.ceil(
              (Date.parse(event.end) - Date.parse(event.start)) / 60000,
            ),
          )
        : item.estimated_minutes,
    priority: item.priority,
    deadline_id: item.deadline_id,
    is_completed: false,
    recurrence: null,
    google_reminders: item.google_reminders ?? undefined,
  });
  return { kind: "task", id: copy.id };
}
