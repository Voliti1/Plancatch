import { api } from "@/lib/api/client";
import { deadlinesApi } from "@/features/deadlines/api";
import { tasksApi } from "@/features/tasks/api";
import type { Deadline } from "@/types/api";
import type { Task } from "@/types/task";

export type ScheduleEntry =
  { kind: "deadline"; item: Deadline } | { kind: "task"; item: Task };
export type SchedulePage = { entries: ScheduleEntry[]; has_more: boolean };
export function listSchedules(
  offset: number,
  query: string,
  deadlines: boolean,
  tasks: boolean,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({
    offset: String(offset),
    limit: "50",
    q: query,
    include_deadlines: String(deadlines),
    include_tasks: String(tasks),
  });
  return api<SchedulePage>(`/api/schedules?${params}`, { signal });
}
export function removeSchedule(key: string, signal?: AbortSignal) {
  const colon = key.indexOf(":"),
    kind = key.slice(0, colon),
    id = key.slice(colon + 1);
  if (kind === "deadline") return deadlinesApi.remove(id, signal);
  if (kind === "task") return tasksApi.remove(id, signal);
  return Promise.reject(new Error("삭제할 일정의 종류를 확인해 주세요."));
}
