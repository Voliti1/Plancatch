"use client";

import { useCurrentTime } from "@/lib/date/use-current-time";
import { useRef, useState } from "react";
import { errorMessage } from "@/lib/api/client";
import { localInput } from "@/lib/date/time-zones";
import { CategoryBadge } from "@/components/category-badge";
import Link from "next/link";
import { Empty, ErrorNotice, Loading } from "@/components/feedback";
import { useResource } from "@/lib/api/use-resource";
import { tasksApi } from "./api";
import { TaskTimes } from "./task-times";
import "./schedule-overview.css";

const loadSchedules = () => tasksApi.list({dashboard:true});

export function DashboardSchedules() {
  const { data, loading, error, reload } = useResource(loadSchedules);
  const pending = useRef(new Set<string>());
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const [toggleError, setToggleError] = useState("");
  async function toggle(id: string, completed: boolean) {
    if (pending.current.has(id)) return;
    pending.current.add(id);
    setBusyIds([...pending.current]);
    setToggleError("");
    try {
      await tasksApi.update(id, { is_completed: !completed });
      reload();
    } catch (error) {
      setToggleError(errorMessage(error));
    } finally {
      pending.current.delete(id);
      setBusyIds([...pending.current]);
    }
  }
  const now = useCurrentTime();
  const today = now === null ? "" : localInput(now).slice(0, 10);
  const ordered = [...(data ?? [])].sort((a, b) => {
    const rank = (task: typeof a) =>
      !task.is_completed &&
      Boolean(task.placement?.start_at ?? task.earliest_start) &&
      localInput(
        Date.parse((task.placement?.start_at ?? task.earliest_start)!),
      ).slice(0, 10) === today
        ? 0
        : !task.is_completed
          ? 1
          : 2;
    return (
      rank(a) - rank(b) ||
      Date.parse(a.placement?.start_at ?? a.earliest_start ?? a.created_at) -
        Date.parse(b.placement?.start_at ?? b.earliest_start ?? b.created_at) ||
      a.title.localeCompare(b.title, "ko")
    );
  });
  return (
    <section
      className="card dashboard-schedules"
      aria-labelledby="dashboard-schedules-title"
    >
      <div className="section-header">
        <h2 id="dashboard-schedules-title">할 일</h2>
        <div className="calendar-dashboard-links">
          <Link href="/calendar">캘린더 보기 →</Link>
          <Link href="/tasks">전체 할 일 보기 →</Link>
        </div>
      </div>
      {toggleError && <ErrorNotice message={toggleError} />}
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorNotice
          message={`할 일을 불러오지 못했어요. ${error}`}
          retry={reload}
        />
      ) : data?.length ? (
        <ul className="dashboard-schedule-list">
          {ordered.slice(0, 5).map((task) => (
            <li key={task.id} className="dashboard-task-item">
              <input
                type="checkbox"
                checked={task.is_completed}
                disabled={busyIds.includes(task.id)}
                aria-label={`${task.title} 완료`}
                onChange={() => void toggle(task.id, task.is_completed)}
              />
              <Link
                className="dashboard-schedule-link"
                href={`/tasks/${encodeURIComponent(task.id)}`}
              >
                <div className="dashboard-schedule-summary">
                  <strong>{task.title}</strong>
                  <CategoryBadge value={task.category} />
                  <span className="small muted">
                    <TaskTimes task={task} />
                    {task.placement && task.placement.block_count > 1
                      ? ` · ${task.placement.block_count}개 구간`
                      : null}
                  </span>
                </div>
                <span className={`tag ${task.is_completed ? "confirmed" : ""}`}>
                  {task.is_completed ? "완료" : "미완료"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title="등록한 할 일이 없어요">
          새 일정 등록하기에서 수동 일정을 입력해 보세요.
        </Empty>
      )}
    </section>
  );
}
