"use client";
import {
  CategoryFilter,
  type Category,
  CategoryBadge,
} from "@/components/category-badge";
import { DeadlineDday } from "@/components/deadline-dday";
import Link from "next/link";
import { useCallback, useState } from "react";
import { PageHeading } from "@/components/page-heading";
import { Empty, ErrorNotice, Loading } from "@/components/feedback";
import { Pagination } from "@/components/pagination";
import { TaskListIcon } from "@/components/task-list-icon";
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
import { useResource } from "@/lib/api/use-resource";
import { TaskTimes } from "@/features/tasks/task-times";
import { DeadlineTimes } from "@/features/deadlines/deadline-times";
import {
  listSchedules,
  removeSchedule,
  type ScheduleEntry,
} from "./schedule-list-api";
import { NewRegistrationLink } from "@/features/deadlines/new-registration-link";
import "./schedule-list.css";
import { DeletionSyncDialog } from "./deletion-sync-dialog";
import { recurrenceSummary } from "@/features/tasks/recurrence-settings";

function ScheduleRows({
  entries,
  query,
  deletion,
}: {
  entries: ScheduleEntry[];
  query: string;
  deletion: ListDeletion;
}) {
  return (
    <div className="deadline-rows schedule-rows">
      {entries.map((entry) => {
        const key = `${entry.kind}:${entry.item.id}`;
        const content = (
          <>
            <span className="date-icon" aria-hidden>
              {entry.kind === "deadline" ? "◷" : <TaskListIcon />}
            </span>
            <div className="row-title">
              <CategoryBadge value={entry.item.category} />
              <strong>
                <HighlightTitle title={entry.item.title} query={query} />
              </strong>
              {entry.kind === "deadline" ? (
                <>
                  <DeadlineDday due={entry.item.due_at} />
                  <DeadlineTimes deadline={entry.item} compact />
                </>
              ) : (
                <>
                  <span>
                    <TaskTimes task={entry.item} />
                  </span>
                  {entry.item.schedule_type === "flexible" && (
                    <span className="small muted">
                      {entry.item.placement
                        ? `캘린더에 등록한 시간 · ${entry.item.placement.block_count}개 구간`
                        : "가능 기간 · 캘린더 시간 등록 전"}
                    </span>
                  )}
                  {entry.item.recurrence && (
                    <span className="small muted">
                      {recurrenceSummary(entry.item.recurrence)} · 삭제 시 전체
                      반복 삭제
                    </span>
                  )}
                </>
              )}
            </div>
            <div className="schedule-row-kind">
              <span className={`tag schedule-kind-${entry.kind}`}>
                {entry.kind === "deadline" ? "마감일" : "할 일"}
              </span>
              <span className="small muted">
                {entry.kind === "deadline"
                  ? entry.item.is_confirmed
                    ? "확인 완료"
                    : "미확인"
                  : entry.item.is_completed
                    ? "완료"
                    : "미완료"}
              </span>
            </div>
            <span aria-hidden>↗</span>
          </>
        );
        return deletion.mode ? (
          <DeleteSelectable
            key={key}
            deletion={deletion}
            id={key}
            label={entry.item.title}
            className="deadline-row"
          >
            {content}
          </DeleteSelectable>
        ) : (
          <Link
            key={key}
            href={`/${entry.kind === "deadline" ? "deadlines" : "tasks"}/${encodeURIComponent(entry.item.id)}`}
            className="deadline-row"
          >
            {content}
          </Link>
        );
      })}
    </div>
  );
}
export function ScheduleList() {
  const search = useTitleSearch();
  const [kinds, setKinds] = useState({
      deadline: true,
      task: true,
      category: null as Category | null,
    }),
    [version, setVersion] = useState(0);
  const deletion = useListDeletion(removeSchedule, () =>
    setVersion((v) => v + 1),
  );
  function filter(kind: "deadline" | "task", checked: boolean) {
    if (deletion.busy) return;
    deletion.exit();
    search.setPage(0);
    setKinds((value) => ({ ...value, [kind]: checked }));
  }
  return (
    <>
      <PageHeading
        eyebrow="SCHEDULES"
        title="일정"
        description="마감일과 할 일을 한곳에서 확인하고 관리하세요."
        action={
          <ListDeleteActions deletion={deletion}>
            <NewRegistrationLink className="button" disabled={deletion.busy}>
              ＋ 일정 등록
            </NewRegistrationLink>
          </ListDeleteActions>
        }
      />
      <CategoryFilter
        value={kinds.category}
        onChange={(category) => {
          if (deletion.busy) return;
          deletion.exit();
          search.setPage(0);
          setKinds((value) => ({ ...value, category }));
        }}
      />
      <TitleSearch
        label="일정 제목 검색"
        query={search.query}
        disabled={deletion.busy}
        onEdit={() => deletion.exit()}
        onApply={(query) => {
          if (!deletion.busy) {
            deletion.exit();
            search.apply(query);
          }
        }}
      />
      <ListDeleteNotice
        deletion={deletion}
        consequence="마지막 연결 마감일을 삭제하면 자료와 검토 기록도 함께 삭제돼요. 연결된 구글 캘린더에 복사한 일정도 자동 삭제하며 다른 할 일은 유지해요."
      />
      <section className="card" aria-label="일정 목록">
        <div className="section-header schedule-list-header">
          <h2>일정 목록</h2>
          <div
            className="schedule-type-filters"
            role="group"
            aria-label="표시할 일정 종류"
          >
            {(["deadline", "task"] as const).map((kind) => (
              <label key={kind} className={kinds[kind] ? "is-checked" : ""}>
                <input
                  type="checkbox"
                  checked={kinds[kind]}
                  disabled={deletion.busy}
                  onChange={(e) => filter(kind, e.target.checked)}
                />
                {kind === "deadline" ? "마감일" : "할 일"}
              </label>
            ))}
          </div>
        </div>
        <p className="small muted">날짜가 빠른 순</p>
        <ScheduleResults
          key={`${search.query}:${search.page}:${version}:${kinds.deadline}:${kinds.task}:${kinds.category}`}
          page={search.page}
          query={search.query}
          kinds={kinds}
          deletion={deletion}
          onPage={(page) => {
            if (!deletion.busy) {
              deletion.exit();
              search.setPage(page);
            }
          }}
        />
      </section>
      <DeletionSyncDialog refreshKey={version} disabled={deletion.busy} />
    </>
  );
}
function ScheduleResults({
  page,
  query,
  kinds,
  deletion,
  onPage,
}: {
  page: number;
  query: string;
  kinds: { deadline: boolean; task: boolean; category: Category | null };
  deletion: ListDeletion;
  onPage: (page: number) => void;
}) {
  const loader = useCallback(
    (signal: AbortSignal) =>
      listSchedules(
        page * 50,
        query,
        kinds.deadline,
        kinds.task,
        signal,
        kinds.category,
      ),
    [page, query, kinds.deadline, kinds.task, kinds.category],
  );
  const { data, loading, error, reload } = useResource(loader);
  if (loading) return <Loading />;
  if (error) return <ErrorNotice message={error} retry={reload} />;
  return (
    <>
      {data?.entries.length ? (
        <ScheduleRows
          entries={data.entries}
          query={query}
          deletion={deletion}
        />
      ) : (
        <Empty
          title={
            query
              ? "검색 결과가 없어요"
              : !kinds.deadline && !kinds.task
                ? "표시할 일정 종류를 선택해 주세요"
                : "아직 일정이 없어요"
          }
        >
          {query
            ? "다른 제목으로 검색해 보세요."
            : !kinds.deadline && !kinds.task
              ? "마감일 또는 할 일을 체크하면 목록에 표시돼요."
              : "첫 일정을 등록해 보세요."}
        </Empty>
      )}
      <Pagination
        page={page}
        count={data?.entries.length ?? 0}
        hasMore={data?.has_more ?? false}
        onChange={onPage}
        disabled={deletion.busy}
      />
    </>
  );
}
