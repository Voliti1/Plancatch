import { api } from "@/lib/api/client";
import { addDays, utcMidnight } from "@/features/calendar/dates";
import type { ScheduledEvent } from "@/types/scheduled-event";
import type { CalendarRegistration } from "@/features/calendar/registrations";

export interface GoogleEvent {
  id: string;
  title: string;
  start_at: string | null;
  end_at: string | null;
  start_date: string | null;
  end_date: string | null;
  local_kind?: "deadline" | "task" | "event" | null;
  local_item_id?: string | null;
}
export interface GoogleEventsPage {
  events: GoogleEvent[];
  has_more: boolean;
  skipped_count: number;
}
export const emptyGoogleEvents: GoogleEventsPage = {
  events: [],
  has_more: false,
  skipped_count: 0,
};
export function readGoogleEvents(start: string, end: string) {
  const query = new URLSearchParams({ start_from: start, end_before: end });
  return api<GoogleEventsPage>(
    `/api/integrations/google-calendar/events?${query}`,
    { signal: AbortSignal.timeout(30000) },
  );
}
export function googleOnDay(event: GoogleEvent, day: string): boolean {
  if (event.start_date && event.end_date)
    return day >= event.start_date && day < event.end_date;
  return Boolean(
    event.start_at &&
    event.end_at &&
    Date.parse(event.start_at) < Date.parse(utcMidnight(addDays(day, 1))) &&
    Date.parse(event.end_at) > Date.parse(utcMidnight(day)),
  );
}
export function withoutLocalDuplicates(
  events: GoogleEvent[],
  local: ScheduledEvent[],
  registered: CalendarRegistration[] = [],
) {
  return events.filter(
    (event) =>
      !registered.some(
        (row) =>
          event.local_item_id === row.id &&
          event.title === row.title &&
          event.local_kind ===
            (row.kind === "deadline" ? "deadline" : "task") &&
          event.start_at &&
          event.end_at &&
          Date.parse(row.start_at) === Date.parse(event.start_at) &&
          Date.parse(event.end_at) ===
            (row.end_at
              ? Date.parse(row.end_at)
              : Date.parse(row.start_at) + 60000),
      ) &&
      !local.some(
        (row) =>
          ((row.google_calendar_id === "primary" &&
            row.google_event_id === event.id) ||
            (event.local_kind === "event" &&
              event.local_item_id === row.id &&
              row.task_title === event.title)) &&
          event.start_at &&
          event.end_at &&
          Date.parse(row.start_at) === Date.parse(event.start_at) &&
          Date.parse(row.end_at) === Date.parse(event.end_at),
      ),
  );
}
