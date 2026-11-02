import { addDays, utcMidnight } from "./dates";
export type TimetableEvent = {
  id: string;
  title: string;
  kind: "deadline" | "task";
  start: string | null;
  end: string | null;
  href?: string;
  startDate?: string | null;
  endDate?: string | null;
  cancelled?: boolean;
};
export function timetableDays(day: string, view: "day" | "week") {
  if (view === "day") return [day];
  const offset = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => addDays(day, i - offset));
}
export function layoutDay(entries: TimetableEvent[], day: string) {
  const first = Date.parse(utcMidnight(day)),
    last = Date.parse(utcMidnight(addDays(day, 1)));
  const rows = entries
    .flatMap((event) => {
      if (!event.start || event.startDate) return [];
      const start = Date.parse(event.start),
        end = event.end ? Date.parse(event.end) : start + 60000;
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start >= last ||
        end <= first ||
        end <= start
      )
        return [];
      const from = Math.min(1415, Math.max(0, (start - first) / 60000));
      return [
        {
          event,
          from,
          to: Math.min(1440, Math.max(from + 25, (end - first) / 60000)),
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
export function hourRegistrationHref(day: string, hour: number) {
  const start = new Date(Date.parse(utcMidnight(day)) + hour * 3600000);
  return (
    "/sources/new?" +
    new URLSearchParams({
      mode: "manual",
      start: start.toISOString(),
      end: new Date(start.getTime() + 3600000).toISOString(),
    })
  );
}
