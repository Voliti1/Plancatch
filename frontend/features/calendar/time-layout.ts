import { localInput, SEOUL, zonedInputToUtc } from "@/lib/date/time-zones";
import { addDays, utcMidnight } from "./dates";
export type TimetableEvent = {
  category?: import("@/components/category-badge").Category | null;
  id: string;
  title: string;
  kind: "deadline" | "task";
  start: string | null;
  end: string | null;
  href?: string;
  startDate?: string | null;
  endDate?: string | null;
  cancelled?: boolean;
  target?: CalendarTarget;
};
export type CalendarTarget =
  | { kind: "deadline"; id: string }
  | { kind: "task"; id: string; occurrence?: string }
  | { kind: "placement"; id: string; taskId: string; locked: boolean };
export function timetableDays(day: string, view: "day" | "week") {
  if (view === "day") return [day];
  const offset = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => addDays(day, i - offset));
}
export function layoutDay(
  entries: TimetableEvent[],
  day: string,
  zone = SEOUL,
) {
  const first = Date.parse(utcMidnight(day, zone)),
    last = Date.parse(utcMidnight(addDays(day, 1), zone));
  const rows = entries
    .flatMap((event) => {
      if (!event.start || event.startDate) return [];
      const start = Date.parse(event.start),
        end = event.end ? Date.parse(event.end) : start + 60000;
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start >= last ||
        (!event.end && start < first) ||
        end <= first ||
        end <= start
      )
        return [];
      const from = start <= first ? 0 : wallMinutes(localInput(start, zone));
      const until = end >= last ? 1440 : wallMinutes(localInput(end, zone));
      return [
        {
          event,
          from,
          to: Math.min(1440, Math.max(from + 25, until)),
          column: 0,
          columns: 1,
        },
      ];
    })
    .sort(
      (a, b) =>
        a.from - b.from || b.to - a.to || a.event.id.localeCompare(b.event.id),
    );
  let cluster: typeof rows = [],
    ends: number[] = [],
    until = -1;
  function finish() {
    for (const row of cluster) row.columns = ends.length;
    cluster = [];
    ends = [];
    until = -1;
  }
  for (const row of rows) {
    if (row.from >= until) finish();
    let col = ends.findIndex((end) => end <= row.from);
    if (col < 0) col = ends.length;
    ends[col] = row.to;
    row.column = col;
    cluster.push(row);
    until = Math.max(until, row.to);
  }
  finish();
  return rows;
}
export function wallMinutes(value: string) {
  return Number(value.slice(-5, -3)) * 60 + Number(value.slice(-2));
}

export function calendarSlot(day: string, minute: number, zone: string) {
  const hour = String(Math.floor(minute / 60)).padStart(2, "0");
  const minutes = String(minute % 60).padStart(2, "0");
  return zonedInputToUtc(`${day}T${hour}:${minutes}`, zone, "next");
}

export function slotRegistrationHref(
  day: string,
  minute: number,
  zone = SEOUL,
) {
  const start = new Date(calendarSlot(day, minute, zone));
  return (
    "/sources/new?" +
    new URLSearchParams({
      mode: "manual",
      start: start.toISOString(),
      end: new Date(start.getTime() + 3600000).toISOString(),
    })
  );
}
