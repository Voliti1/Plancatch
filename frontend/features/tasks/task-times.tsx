import { formatSeoul } from "@/lib/date/seoul";
import type { Task } from "@/types/task";

export function TaskTimes({ task }: { task: Task }) {
  const start = task.placement?.start_at ?? task.earliest_start;
  const end = task.placement?.end_at ?? task.latest_end;
  return (
    <>
      {start ? <time dateTime={start}>{formatSeoul(start)}</time> : "시작 미정"}
      {" → "}
      {end ? <time dateTime={end}>{formatSeoul(end)}</time> : "종료 미정"}
    </>
  );
}
