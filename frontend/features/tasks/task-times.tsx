import { useScheduleTime } from "@/features/settings/time-zone";
import type { Task } from "@/types/task";

export function TaskTimes({ task }: { task: Task }) {
  const { formatLocal } = useScheduleTime();
  const start = task.placement?.start_at ?? task.earliest_start;
  const end = task.placement?.end_at ?? task.latest_end;
  if (!start && !end) return <>시간 미정</>;
  return (
    <>
      {start ? <time dateTime={start}>{formatLocal(start)}</time> : "시작 미정"}
      {" → "}
      {end ? <time dateTime={end}>{formatLocal(end)}</time> : "종료 미정"}
    </>
  );
}
