"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Empty, ErrorNotice, Loading } from "@/components/feedback";
import { api, errorMessage } from "@/lib/api/client";
import { useResource } from "@/lib/api/use-resource";
import { formatSeoul, toSeoulInput } from "@/lib/date/seoul";
import type { Task } from "@/types/task";
import { dayLabel } from "./dates";

export type PlanningTask = Task & {
  sort_at?: string | null;
  completion_due_at?: string | null;
};
type Page = {
  entries: PlanningTask[];
  has_more: boolean;
  next_offset?: number | null;
};
const korean = new Intl.Collator("ko-KR");
function sortTime(task: PlanningTask) {
  const time = Date.parse(
    task.sort_at ?? task.latest_end ?? task.earliest_start ?? "",
  );
  return Number.isFinite(time) ? time : Infinity;
}

export const newPlanningTask = "/sources/new?mode=manual&timing=flexible";

export function loadPlanningTasks(
  replaceExisting: boolean,
  signal: AbortSignal,
  query = "",
  offset = 0,
  ids: string[] = [],
) {
  const params = new URLSearchParams({ q: query });
  if (offset) params.set("offset", String(offset));
  if (replaceExisting) params.set("replace_existing", "true");
  ids.forEach((id) => params.append("ids", id));
  return api<Page>("/api/scheduling/tasks?" + params, { signal });
}

function TaskTiming({ task }: { task: PlanningTask }) {
  const due = task.completion_due_at ?? task.latest_end;
  return (
    <small>
      {task.estimated_minutes ? task.estimated_minutes + "분" : "소요시간 미정"}
      {" · "}
      {due ? "완료 기한 " + formatSeoul(due) : "마감일 없음"}
    </small>
  );
}

export function PlanningTaskPicker({
  selected,
  onChange,
  replaceExisting,
}: {
  selected: PlanningTask[];
  onChange: (tasks: PlanningTask[]) => void;
  replaceExisting: boolean;
}) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [extra, setExtra] = useState<{
    base: Page;
    entries: PlanningTask[];
    has_more: boolean;
    offset: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const more = useRef<AbortController | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => () => more.current?.abort(), []);
  const tasks = useResource(
    useCallback(
      (signal: AbortSignal) =>
        loadPlanningTasks(replaceExisting, signal, query),
      [query, replaceExisting],
    ),
  );
  const current = extra?.base === tasks.data ? extra : null;
  const rows = new Map(
    [...(tasks.data?.entries ?? []), ...(current?.entries ?? [])].map(
      (task) => [task.id, task],
    ),
  );
  const groups = new Map<string, PlanningTask[]>();
  const sorted = [...rows.values()].sort(
    (a, b) =>
      sortTime(a) - sortTime(b) ||
      korean.compare(a.title, b.title) ||
      a.id.localeCompare(b.id),
  );
  sorted.forEach((task) => {
    const value = task.sort_at ?? task.latest_end ?? task.earliest_start;
    const day =
      value && Number.isFinite(Date.parse(value))
        ? toSeoulInput(value).slice(0, 10)
        : "";
    const group = groups.get(day);
    if (group) group.push(task);
    else groups.set(day, [task]);
  });
  const visible = search.trim() === query;
  const hasMore = current?.has_more ?? tasks.data?.has_more;

  async function nextPage() {
    const base = tasks.data;
    if (!base || more.current) return;
    const controller = new AbortController();
    const offset = current?.offset ?? base.next_offset ?? 100;
    more.current = controller;
    setBusy(true);
    setError("");
    try {
      const next = await loadPlanningTasks(
        replaceExisting,
        controller.signal,
        query,
        offset,
      );
      if (!controller.signal.aborted) {
        setExtra({
          base,
          entries: [...(current?.entries ?? []), ...next.entries],
          has_more: next.has_more,
          offset: next.next_offset ?? offset + 100,
        });
      }
    } catch (err) {
      if (!controller.signal.aborted) setError(errorMessage(err));
    } finally {
      if (more.current === controller) {
        more.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <div className="planning-picker">
      <label>
        할 일 제목 검색
        <input
          type="search"
          autoComplete="off"
          placeholder="할 일 제목을 입력하세요"
          value={search}
          maxLength={255}
          onChange={(event) => {
            more.current?.abort();
            more.current = null;
            setBusy(false);
            setError("");
            setSearch(event.target.value);
          }}
        />
      </label>
      <section
        className="planning-picker-list"
        aria-label="시간을 정할 할 일 목록"
      >
        {tasks.loading || !visible ? (
          <Loading />
        ) : tasks.error ? (
          <ErrorNotice message={tasks.error} retry={tasks.reload} />
        ) : rows.size ? (
          <>
            {[...groups].map(([day, items]) => (
              <div key={day} className="planning-picker-group">
                <h3>{day ? dayLabel(day) : "날짜 미정"}</h3>
                <ul className="planning-tasks">
                  {items.map((task) => {
                    const checked = selected.some(
                      (item) => item.id === task.id,
                    );
                    return (
                      <li key={task.id} data-selected={checked || undefined}>
                        <label className="checkbox-row">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={
                              !checked &&
                              (selected.length >= 20 || !task.estimated_minutes)
                            }
                            onChange={(event) =>
                              onChange(
                                event.target.checked
                                  ? [...selected, task]
                                  : selected.filter(
                                      (item) => item.id !== task.id,
                                    ),
                              )
                            }
                          />
                          <span>
                            <strong>{task.title}</strong>
                            <TaskTiming task={task} />
                          </span>
                        </label>
                        {!task.estimated_minutes && (
                          <Link href={"/tasks/" + encodeURIComponent(task.id)}>
                            소요시간 설정
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {error && <ErrorNotice message={error} />}
            {hasMore && (
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={nextPage}
              >
                {busy ? "불러오는 중…" : "할 일 더 보기"}
              </button>
            )}
          </>
        ) : (
          <Empty
            title={
              query
                ? "검색 결과가 없습니다"
                : replaceExisting
                  ? "시간을 다시 정할 할 일이 없습니다"
                  : "아직 시간을 정할 할 일이 없습니다"
            }
          >
            {query ? (
              "다른 제목으로 검색해 보세요."
            ) : replaceExisting ? (
              "캘린더에 저장한 시간이 아직 시작되지 않은 할 일을 선택할 수 있어요."
            ) : (
              <span className="planning-picker-empty-action">
                <span>
                  시간 미정 할 일을 만들면 여기에서 바로 선택할 수 있어요.
                </span>
                <Link href={newPlanningTask} className="button secondary">
                  새 할 일 만들기
                </Link>
              </span>
            )}
          </Empty>
        )}
      </section>
      {!replaceExisting && (rows.size > 0 || Boolean(query)) && (
        <p className="small">
          <Link href={newPlanningTask}>새 할 일 만들기</Link>
        </p>
      )}
      {selected.length > 0 && (
        <div className="planning-selected">
          <div className="section-header">
            <h3>선택한 할 일 {selected.length}개</h3>
            <button
              type="button"
              className="text-button"
              onClick={() => onChange([])}
            >
              모두 해제
            </button>
          </div>
          <ul className="planning-selected-list">
            {selected.map((task) => (
              <li key={task.id}>
                <span>
                  <strong>{task.title}</strong>
                  <TaskTiming task={task} />
                </span>
                <button
                  type="button"
                  className="text-button"
                  aria-label={task.title + " 선택 해제"}
                  onClick={() =>
                    onChange(selected.filter((item) => item.id !== task.id))
                  }
                >
                  해제
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
