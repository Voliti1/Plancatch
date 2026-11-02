"use client";
import Link from "next/link";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
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
import { formatSeoul } from "@/lib/date/seoul";
import { DeadlineTimes } from "@/features/deadlines/deadline-times";
import { DeadlineForm } from "@/features/deadlines/deadline-form";
import { deadlinesApi } from "@/features/deadlines/api";
import { TaskForm } from "@/features/tasks/task-form";
import { tasksApi } from "@/features/tasks/api";
import {
  listSchedules,
  removeSchedule,
  type ScheduleEntry,
} from "./schedule-list-api";
import "./schedule-list.css";

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
              <strong>
                <HighlightTitle title={entry.item.title} query={query} />
              </strong>
              {entry.kind === "deadline" ? (
                <DeadlineTimes deadline={entry.item} compact />
              ) : (
                <>
                  <span>
                    {entry.item.earliest_start ? (
                      <time dateTime={entry.item.earliest_start}>
                        {formatSeoul(entry.item.earliest_start)}
                      </time>
                    ) : (
                      "시작 미정"
                    )}
                    {" → "}
                    {entry.item.latest_end ? (
                      <time dateTime={entry.item.latest_end}>
                        {formatSeoul(entry.item.latest_end)}
                      </time>
                    ) : (
                      "종료 미정"
                    )}
                  </span>
                  {entry.item.schedule_type === "flexible" && (
                    <span className="small muted">
                      가능 기간 · 실제 배치 시간은 상세에서 확인하세요.
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
  const search = useTitleSearch(),
    router = useRouter();
  const [creating, setCreating] = useState(false),
    [creatingKind, setCreatingKind] = useState<"deadline" | "task">("deadline");
  const [kinds, setKinds] = useState({ deadline: true, task: true }),
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
          <ListDeleteActions
            deletion={deletion}
            onToggle={() => setCreating(false)}
          >
            <button
              disabled={deletion.busy}
              aria-expanded={creating}
              onClick={() => {
                deletion.exit();
                setCreating(!creating);
              }}
            >
              {creating ? "등록 닫기" : "＋ 일정 등록"}
            </button>
          </ListDeleteActions>
        }
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
      {creating && (
        <section className="card form-card" aria-label="새 일정 등록">
          <h2>새 일정</h2>
          <div
            className="schedule-create-kinds"
            role="group"
            aria-label="등록할 일정 종류"
          >
            {(["deadline", "task"] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                className={creatingKind === kind ? "" : "secondary"}
                aria-pressed={creatingKind === kind}
                onClick={() => setCreatingKind(kind)}
              >
                {kind === "deadline" ? "마감일로 등록" : "할 일로 등록"}
              </button>
            ))}
          </div>
          {creatingKind === "deadline" ? (
            <DeadlineForm
              onSave={async (payload) => {
                const item = await deadlinesApi.create(payload);
                router.push(`/deadlines/${item.id}`);
              }}
            />
          ) : (
            <TaskForm
              variant="calendar"
              submitLabel="할 일 등록"
              onCancel={() => setCreating(false)}
              onSave={async (payload) => {
                const item = await tasksApi.create(payload);
                router.push(`/tasks/${item.id}`);
              }}
            />
          )}
        </section>
      )}
      <ListDeleteNotice
        deletion={deletion}
        consequence="마지막 연결 마감일을 삭제하면 원본 자료와 검토 기록도 함께 삭제됩니다. 연결된 Google 사본도 자동 삭제하며 다른 할 일은 유지합니다."
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
        <p className="small muted">
          날짜가 빠른 순 · 시간 미정은 마지막 · 한국 시간
        </p>
        <ScheduleResults
          key={`${search.query}:${search.page}:${version}:${kinds.deadline}:${kinds.task}`}
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
  kinds: { deadline: boolean; task: boolean };
  deletion: ListDeletion;
  onPage: (page: number) => void;
}) {
  const loader = useCallback(
    (signal: AbortSignal) =>
      listSchedules(page * 50, query, kinds.deadline, kinds.task, signal),
    [page, query, kinds.deadline, kinds.task],
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
              ? "검색 결과가 없습니다"
              : !kinds.deadline && !kinds.task
                ? "표시할 일정 종류를 선택해 주세요"
                : "아직 일정이 없습니다"
          }
        >
          {query
            ? "다른 제목으로 검색해 보세요."
            : !kinds.deadline && !kinds.task
              ? "마감일 또는 할 일을 체크하면 목록에 표시됩니다."
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
