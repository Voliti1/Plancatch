import { api } from "@/lib/api/client";
import { addDays, utcMidnight } from "@/features/calendar/dates";
import type { ScheduledEvent } from "@/types/scheduled-event";

export interface GoogleEvent {
  id: string;
  title: string;
  start_at: string | null;
  end_at: string | null;
  start_date: string | null;
  end_date: string | null;
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
) {
  return events.filter(
    (event) =>
      !local.some(
        (row) =>
          row.google_calendar_id === "primary" &&
          row.google_event_id === event.id &&
          event.start_at &&
          event.end_at &&
          Date.parse(row.start_at) === Date.parse(event.start_at) &&
          Date.parse(row.end_at) === Date.parse(event.end_at),
      ),
  );
}
