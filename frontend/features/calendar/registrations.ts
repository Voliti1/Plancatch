import { api } from "@/lib/api/client";
import { addDays, utcMidnight } from "./dates";

export interface CalendarRegistration {
  id: string;
  kind: "deadline" | "fixed_task";
  title: string;
  start_at: string;
  end_at: string | null;
  is_confirmed: boolean;
  is_completed: boolean;
}
export function readRegistrations(
  start: string,
  end: string,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ start_from: start, end_before: end });
  return api<{ entries: CalendarRegistration[]; has_more: boolean }>(
    `/api/calendar/registrations?${query}`,
    { signal },
  );
}
export function registrationOnDay(item: CalendarRegistration, day: string) {
  const start = Date.parse(item.start_at),
    first = Date.parse(utcMidnight(day)),
    last = Date.parse(utcMidnight(addDays(day, 1)));
  return item.end_at
    ? start < last && Date.parse(item.end_at) > first
    : start >= first && start < last;
}
export function registrationHref(item: CalendarRegistration) {
  return `/${item.kind === "deadline" ? "deadlines" : "tasks"}/${encodeURIComponent(item.id)}`;
}
