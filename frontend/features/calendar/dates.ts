import { toSeoulInput } from "@/lib/date/seoul";
import type { ScheduledEvent } from "@/types/scheduled-event";

export const todaySeoul = () =>
  toSeoulInput(new Date().toISOString()).slice(0, 10);
export const utcMidnight = (day: string) =>
  new Date(`${day}T00:00:00+09:00`).toISOString();
const dayFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  dateStyle: "full",
});
export const dayLabel = (day: string) =>
  dayFormatter.format(new Date(`${day}T12:00:00+09:00`));
export function addDays(day: string, count: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
export function shiftMonth(day: string, count: number) {
  const date = new Date(`${day.slice(0, 7)}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + count);
  return date.toISOString().slice(0, 10);
}
export function calendarDays(day: string, view: "month" | "week") {
  const first = view === "month" ? `${day.slice(0, 7)}-01` : day;
  const start = addDays(first, -new Date(`${first}T00:00:00Z`).getUTCDay());
  return Array.from({ length: view === "month" ? 42 : 7 }, (_, index) =>
    addDays(start, index),
  );
}
export function onDay(event: ScheduledEvent, day: string) {
  return (
    Date.parse(event.start_at) < Date.parse(utcMidnight(addDays(day, 1))) &&
    Date.parse(event.end_at) > Date.parse(utcMidnight(day))
  );
}
export const statusLabel = {
  recommended: "제안",
  approved: "확정",
  cancelled: "취소",
  synced: "동기화됨",
};
export const lockedEvent = (event: ScheduledEvent) =>
  event.status === "synced" || event.google_event_id !== null;
