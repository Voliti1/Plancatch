"use client";
import { useCurrentTime } from "@/lib/date/use-current-time";
export function seoulDay(value: number) {
  return Math.floor((value + 9 * 3600000) / 86400000);
}
export function deadlineDay(due: string, now = Date.now()) {
  if (Date.parse(due) <= now) return { text: "마감 지남", style: "is-past" };
  const days = seoulDay(Date.parse(due)) - seoulDay(now);
  return {
    text: days === 0 ? "D-Day" : `D-${days}`,
    style: days <= 3 ? "is-urgent" : "",
  };
}
export function DeadlineDday({ due }: { due: string }) {
  const now = useCurrentTime();
  if (now === null) return null;
  const badge = deadlineDay(due, now);
  return <span className={`dday ${badge.style}`}>{badge.text}</span>;
}
