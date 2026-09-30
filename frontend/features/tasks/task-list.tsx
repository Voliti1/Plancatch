"use client";
import Link from "next/link";
import { useCallback, useId, useState } from "react";
import { Empty, ErrorNotice, Loading } from "@/components/feedback";
import { PageHeading } from "@/components/page-heading";
import { Pagination } from "@/components/pagination";
import { useResource } from "@/lib/api/use-resource";
import type { ScheduleType } from "@/types/task";
import { tasksApi } from "./api";
import { TaskRows } from "./task-rows";

export function TaskList() {
  const completedLabelId = useId();
  const typeLabelId = useId();
  const [filters, setFilters] = useState({
    completed: "all",
    type: "all",
    page: 0,
  });
  return (
    <>
      <PageHeading
        eyebrow="YOUR TASKS"
        title="작업"
        description="해야 할 일을 정리하고 하나씩 완료해 보세요."
        action={
          <Link className="button" href="/tasks/new">
            ＋ 작업 등록
          </Link>
        }
      />
      <div className="task-filters">
        <label>
          <span id={completedLabelId}>완료 상태</span>
          <select
            aria-labelledby={completedLabelId}
            value={filters.completed}
            onChange={(event) =>
              setFilters({ ...filters, completed: event.target.value, page: 0 })
            }
          >
            <option value="all">전체</option>
            <option value="false">미완료</option>
            <option value="true">완료</option>
          </select>
        </label>
        <label>
          <span id={typeLabelId}>작업 유형</span>
          <select
            aria-labelledby={typeLabelId}
            value={filters.type}
            onChange={(event) =>
              setFilters({ ...filters, type: event.target.value, page: 0 })
            }
          >
            <option value="all">전체</option>
            <option value="flexible">유동 작업</option>
            <option value="fixed">고정 일정</option>
          </select>
        </label>
      </div>
      <TaskPage
        key={`${filters.completed}-${filters.type}-${filters.page}`}
        completed={filters.completed}
        type={filters.type}
        page={filters.page}
        onPage={(page) => setFilters({ ...filters, page })}
      />
    </>
  );
}
function TaskPage({
  completed,
  type,
  page,
  onPage,
}: {
  completed: string;
  type: string;
  page: number;
  onPage: (page: number) => void;
}) {
  const loader = useCallback(
    () =>
      tasksApi.list({
        offset: page * 50,
        is_completed: completed === "all" ? undefined : completed === "true",
        schedule_type: type === "all" ? undefined : (type as ScheduleType),
      }),
    [completed, type, page],
  );
  const { data, error, loading, reload } = useResource(loader);
  if (loading) return <Loading />;
  if (error) return <ErrorNotice message={error} retry={reload} />;
  return (
    <>
      <section className="card">
        <div className="section-header">
          <h2>작업 목록</h2>
          <span className="small muted">최근 등록 순</span>
        </div>
        {data?.length ? (
          <TaskRows tasks={data} onUpdated={reload} />
        ) : (
          <Empty title="표시할 작업이 없습니다">
            새 작업을 등록하거나 필터를 변경해 보세요.
          </Empty>
        )}
      </section>
      <Pagination page={page} count={data?.length ?? 0} onChange={onPage} />
    </>
  );
}
