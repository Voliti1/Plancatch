"use client";
import Link from "next/link";
import { useCallback, useState } from "react";
import { Empty, ErrorNotice, Loading } from "@/components/feedback";
import { Pagination } from "@/components/pagination";
import { useResource } from "@/lib/api/use-resource";
import { tasksApi } from "./api";
import { TaskRows } from "./task-rows";
export function DeadlineTasks({ deadlineId }: { deadlineId: string }) {
  const [page, setPage] = useState(0);
  return (
    <section className="card form-card deadline-tasks">
      <div className="section-header">
        <h2>이 마감일의 작업</h2>
        <Link
          className="button secondary"
          href={`/tasks/new?deadline_id=${encodeURIComponent(deadlineId)}`}
        >
          ＋ 작업 등록
        </Link>
      </div>
      <DeadlineTaskPage
        key={`${deadlineId}-${page}`}
        deadlineId={deadlineId}
        page={page}
        onPage={setPage}
      />
    </section>
  );
}
function DeadlineTaskPage({
  deadlineId,
  page,
  onPage,
}: {
  deadlineId: string;
  page: number;
  onPage: (page: number) => void;
}) {
  const loader = useCallback(
    () => tasksApi.list({ deadline_id: deadlineId, offset: page * 50 }),
    [deadlineId, page],
  );
  const { data, loading, error, reload } = useResource(loader);
  if (loading) return <Loading />;
  if (error) return <ErrorNotice message={error} retry={reload} />;
  return (
    <>
      {data?.length ? (
        <TaskRows tasks={data} onUpdated={reload} />
      ) : (
        <Empty title="연결된 작업이 없습니다">
          이 마감일을 준비할 첫 작업을 등록해 보세요.
        </Empty>
      )}
      <Pagination page={page} count={data?.length ?? 0} onChange={onPage} />
    </>
  );
}
