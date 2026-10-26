"use client";
import Link from "next/link";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { deadlinesApi } from "./api";
import { DeadlineForm } from "./deadline-form";
import { DeadlineTimes } from "./deadline-times";
import { useResource } from "@/lib/api/use-resource";
import { Empty, ErrorNotice, Loading } from "@/components/feedback";
import { PageHeading } from "@/components/page-heading";
import { Pagination } from "@/components/pagination";
import type { Deadline } from "@/types/api";
import {
  HighlightTitle,
  TitleSearch,
  useTitleSearch,
} from "@/components/title-search";
import {
  DeleteSelectable,
  ListDeleteActions,
  ListDeleteNotice,
  useListDeletion,
  type ListDeletion,
} from "@/components/list-deletion";
export function DeadlineRows({
  deadlines,
  deletion,
  query = "",
}: {
  deadlines: Deadline[];
  deletion?: ListDeletion;
  query?: string;
}) {
  return (
    <div className="deadline-rows">
      {deadlines.map((item) => {
        const content = (
          <>
            <span className="date-icon" aria-hidden>
              ◷
            </span>
            <div className="row-title">
              <strong>
                <HighlightTitle title={item.title} query={query} />
              </strong>
              <DeadlineTimes deadline={item} compact />
              <span>{item.deadline_type || "일반"}</span>
            </div>
            <span className={`tag ${item.is_confirmed ? "confirmed" : ""}`}>
              {item.is_confirmed ? "확인 완료" : "미확인"}
            </span>
            <span aria-hidden>↗</span>
          </>
        );
        return deletion?.mode ? (
          <DeleteSelectable
            key={item.id}
            deletion={deletion}
            id={item.id}
            label={item.title}
            className="deadline-row"
          >
            {content}
          </DeleteSelectable>
        ) : (
          <Link
            className="deadline-row"
            href={`/deadlines/${item.id}`}
            key={item.id}
          >
            {content}
          </Link>
        );
      })}
    </div>
  );
}
export function DeadlineList() {
  const search = useTitleSearch();
  const { page, query } = search;
  const [creating, setCreating] = useState(false);
  const [version, setVersion] = useState(0);
  const deletion = useListDeletion(deadlinesApi.remove, () =>
    setVersion((value) => value + 1),
  );
  const router = useRouter();
  return (
    <>
      <PageHeading
        eyebrow="DEADLINES"
        title="마감일"
        description="중요한 날짜를 확인하고, 여유 있게 준비하세요."
        action={
          <ListDeleteActions
            deletion={deletion}
            onToggle={() => setCreating(false)}
          >
            <button
              disabled={deletion.busy}
              onClick={() => {
                deletion.exit();
                setCreating(!creating);
              }}
              aria-expanded={creating}
            >
              {creating ? "등록 닫기" : "＋ 마감일 등록"}
            </button>
          </ListDeleteActions>
        }
      />
      <TitleSearch
        label="마감일 제목 검색"
        query={query}
        disabled={deletion.busy}
        onEdit={() => deletion.exit()}
        onApply={(value) => {
          if (!deletion.busy) {
            deletion.exit();
            search.apply(value);
          }
        }}
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
      <ListDeleteNotice
        deletion={deletion}
        consequence="연결된 할 일과 Google 일정은 유지됩니다."
      />
      <DeadlinePage
        key={`${query}:${page}:${version}`}
        page={page}
        query={query}
        deletion={deletion}
        onChange={(next) => {
          if (deletion.busy) return;
          deletion.exit();
          search.setPage(next);
        }}
      />
    </>
  );
}
function DeadlinePage({
  page,
  query,
  onChange,
  deletion,
}: {
  page: number;
  query: string;
  onChange: (page: number) => void;
  deletion: ListDeletion;
}) {
  const loader = useCallback(
    () => deadlinesApi.list(page * 50, query),
    [page, query],
  );
  const { data, error, loading, reload } = useResource(loader);
  if (loading) return <Loading />;
  if (error) return <ErrorNotice message={error} retry={reload} />;
  return (
    <>
      <div className="card">
        <div className="section-header">
          <h2>마감일 목록</h2>
          <span className="small muted">공식 마감일이 빠른 순 · 한국 시간</span>
        </div>
        {data?.length ? (
          <DeadlineRows deadlines={data} deletion={deletion} query={query} />
        ) : (
          <Empty
            title={query ? "검색 결과가 없습니다" : "아직 마감일이 없습니다"}
          >
            {query
              ? "다른 제목으로 검색해 보세요."
              : "첫 마감일을 등록하고 계획을 시작해 보세요."}
          </Empty>
        )}
      </div>
      <Pagination
        page={page}
        count={data?.length ?? 0}
        onChange={onChange}
        disabled={deletion.busy}
      />
    </>
  );
}
