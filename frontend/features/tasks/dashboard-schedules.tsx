"use client";

import Link from "next/link";
import { Empty, ErrorNotice, Loading } from "@/components/feedback";
import { useResource } from "@/lib/api/use-resource";
import { tasksApi } from "./api";
import { TaskTimes } from "./task-times";
import "./schedule-overview.css";

const loadSchedules = () => tasksApi.list();

export function DashboardSchedules() {
  const { data, loading, error, reload } = useResource(loadSchedules);
  return (
    <section
      className="card dashboard-schedules"
      aria-labelledby="dashboard-schedules-title"
    >
      <div className="section-header">
        <h2 id="dashboard-schedules-title">등록한 일정</h2>
        <div className="calendar-dashboard-links">
          <Link href="/calendar">캘린더 보기 →</Link>
          <Link href="/tasks">전체 일정 보기 →</Link>
        </div>
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorNotice
          message={`일정을 불러오지 못했어요. ${error}`}
          retry={reload}
        />
      ) : data?.length ? (
        <ul className="dashboard-schedule-list">
          {data.slice(0, 5).map((task) => (
            <li key={task.id}>
              <Link
                className="dashboard-schedule-link"
                href={`/tasks/${encodeURIComponent(task.id)}`}
              >
                <div className="dashboard-schedule-summary">
                  <strong>{task.title}</strong>
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
        <Empty title="등록한 일정이 없어요">
          새 일정 등록하기에서 수동 일정을 입력해 보세요.
        </Empty>
      )}
    </section>
  );
}
