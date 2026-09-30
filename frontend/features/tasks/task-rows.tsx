"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { ErrorNotice } from "@/components/feedback";
import { errorMessage } from "@/lib/api/client";
import { formatSeoul } from "@/lib/date/seoul";
import type { Task } from "@/types/task";
import { tasksApi } from "./api";
export function TaskRows({
  tasks,
  onUpdated,
}: {
  tasks: Task[];
  onUpdated: () => void;
}) {
  return (
    <div className="task-rows">
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} onUpdated={onUpdated} />
      ))}
    </div>
  );
}
function TaskRow({ task, onUpdated }: { task: Task; onUpdated: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  async function toggle() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await tasksApi.update(task.id, { is_completed: !task.is_completed });
      onUpdated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <article className="task-item">
      <div className="task-row">
        <div className="task-row-main">
          <Link
            className={
              task.is_completed ? "task-title completed" : "task-title"
            }
            href={`/tasks/${encodeURIComponent(task.id)}`}
          >
            {task.title}
          </Link>
          <p className="muted small">
            {task.estimated_minutes === null
              ? "소요시간 미정"
              : `${task.estimated_minutes}분`}{" "}
            · 우선순위 {task.priority} ·{" "}
            {task.schedule_type === "fixed" ? "고정 일정" : "유동 작업"}
          </p>
          {task.latest_end && (
            <p className="muted small">
              최종 완료 {formatSeoul(task.latest_end)}
            </p>
          )}
        </div>
        <button
          className="secondary task-toggle"
          disabled={busy}
          aria-pressed={task.is_completed}
          aria-label={`${task.title} ${task.is_completed ? "미완료로 변경" : "완료 처리"}`}
          onClick={() => void toggle()}
        >
          {busy ? "처리 중…" : task.is_completed ? "완료 ✓" : "완료 처리"}
        </button>
      </div>
      {error && <ErrorNotice message={error} />}
    </article>
  );
}
