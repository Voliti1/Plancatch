"use client";
import Link from "next/link";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { deadlinesApi } from "./api";
import { DeadlineForm } from "./deadline-form";
import { useResource } from "@/lib/api/use-resource";
import { formatSeoul } from "@/lib/date/seoul";
import { Empty, ErrorNotice, Loading } from "@/components/feedback";
import { PageHeading } from "@/components/page-heading";
import { Pagination } from "@/components/pagination";
import type { Deadline } from "@/types/api";
export function DeadlineRows({ deadlines }: { deadlines: Deadline[] }) {
  return (
    <div className="deadline-rows">
      {deadlines.map((item) => (
        <Link
          className="deadline-row"
          href={`/deadlines/${item.id}`}
          key={item.id}
        >
          <span className="date-icon" aria-hidden>
            ◷
          </span>
          <div className="row-title">
            <strong>{item.title}</strong>
            <span>
              {formatSeoul(item.due_at)} · {item.deadline_type || "일반"}
            </span>
          </div>
          <span className={`tag ${item.is_confirmed ? "confirmed" : ""}`}>
            {item.is_confirmed ? "확인 완료" : "미확인"}
          </span>
          <span aria-hidden>↗</span>
        </Link>
      ))}
    </div>
  );
}
export function DeadlineList() {
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const router = useRouter();
  return (
    <>
      <PageHeading
        eyebrow="DEADLINES"
        title="마감일"
        description="중요한 날짜를 확인하고, 여유 있게 준비하세요."
        action={
          <button
            onClick={() => setCreating(!creating)}
            aria-expanded={creating}
          >
            {creating ? "등록 닫기" : "＋ 마감일 등록"}
          </button>
        }
      />
      {creating && (
        <section className="card form-card">
          <h2>새 마감일</h2>
          <DeadlineForm
            onSave={async (payload) => {
              const item = await deadlinesApi.create(payload);
              router.push(`/deadlines/${item.id}`);
            }}
          />
        </section>
      )}
      <DeadlinePage key={page} page={page} onChange={setPage} />
    </>
  );
}
function DeadlinePage({
  page,
  onChange,
}: {
  page: number;
  onChange: (page: number) => void;
}) {
  const loader = useCallback(() => deadlinesApi.list(page * 50), [page]);
  const { data, error, loading, reload } = useResource(loader);
  if (loading) return <Loading />;
  if (error) return <ErrorNotice message={error} retry={reload} />;
  return (
    <>
      <div className="card">
        <div className="section-header">
          <h2>마감일 목록</h2>
          <span className="small muted">마감일이 빠른 순 · 한국 시간</span>
        </div>
        {data?.length ? (
          <DeadlineRows deadlines={data} />
        ) : (
          <Empty title="아직 마감일이 없습니다">
            첫 마감일을 등록하고 계획을 시작해 보세요.
          </Empty>
        )}
      </div>
      <Pagination page={page} count={data?.length ?? 0} onChange={onChange} />
    </>
  );
}
