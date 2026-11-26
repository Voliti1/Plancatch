import { useScheduleTime } from "@/features/settings/time-zone";
import type { Deadline } from "@/types/api";
import { formatSafetyBuffer } from "./safety-buffer";

export function DeadlineTimes({
  deadline,
  compact = false,
}: {
  deadline: Deadline;
  compact?: boolean;
}) {
  const { formatLocal } = useScheduleTime();
  return (
    <dl
      className={`deadline-times${compact ? " compact" : ""}`}
      aria-label="저장된 마감일"
    >
      <div>
        <dt>공식 마감</dt>
        <dd>
          <time dateTime={deadline.due_at}>{formatLocal(deadline.due_at)}</time>
        </dd>
      </div>
      <div>
        <dt>안전 마감</dt>
        <dd>
          {deadline.safe_due_at ? (
            <>
              <time dateTime={deadline.safe_due_at}>
                {formatLocal(deadline.safe_due_at)}
              </time>
              {deadline.safety_buffer_minutes != null && (
                <small className="safety-buffer-value">
                  {formatSafetyBuffer(deadline.safety_buffer_minutes)} 전
                </small>
              )}
            </>
          ) : (
            "미설정"
          )}
        </dd>
      </div>
    </dl>
  );
}
