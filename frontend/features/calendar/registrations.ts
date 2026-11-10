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
  is_recurring?: boolean;
  series_id?: string | null;
  original_start?: string | null;
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
  const href = `/${item.kind === "deadline" ? "deadlines" : "tasks"}/${encodeURIComponent(item.id)}`;
  return item.is_recurring
    ? `${href}?${new URLSearchParams({ occurrence: item.original_start ?? item.start_at })}`
    : href;
}
