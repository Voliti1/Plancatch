"use client";

import Link from "next/link";
import { Empty, ErrorNotice, Loading } from "@/components/feedback";
import { useResource } from "@/lib/api/use-resource";
import { formatSeoul } from "@/lib/date/seoul";
import { tasksApi } from "./api";
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
        <Link href="/tasks">전체 일정 보기 →</Link>
      </div>
      <p className="muted small">최근 등록순으로 최대 5개를 보여줍니다.</p>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorNotice
          message={`일정을 불러오지 못했습니다. ${error}`}
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
                    {task.earliest_start ? (
                      <time dateTime={task.earliest_start}>
                        {formatSeoul(task.earliest_start)}
                      </time>
                    ) : (
                      "시작 미정"
                    )}
                    {" → "}
                    {task.latest_end ? (
                      <time dateTime={task.latest_end}>
                        {formatSeoul(task.latest_end)}
                      </time>
                    ) : (
                      "종료 미정"
                    )}
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
        <Empty title="등록한 일정이 없습니다">
          새 일정 등록하기에서 수동 일정을 입력해 보세요.
        </Empty>
      )}
      <p className="muted small schedule-window-note">
        표시된 시간은 입력한 가능 기간입니다. 실제 캘린더 배치와 동기화는 준비
        중입니다.
      </p>
    </section>
  );
}
