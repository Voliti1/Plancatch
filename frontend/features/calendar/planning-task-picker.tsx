"use client";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ErrorNotice, Loading } from "@/components/feedback";
import { api, errorMessage } from "@/lib/api/client";
import { useResource } from "@/lib/api/use-resource";
import { toSeoulInput } from "@/lib/date/seoul";
import type { Task } from "@/types/task";

type Candidate = Task & { sort_at?: string | null };
type Page = {
  entries: Candidate[];
  has_more: boolean;
  next_offset?: number | null;
};
const korean = new Intl.Collator("ko-KR");
const moment = (task: Candidate) => {
  const value = task.sort_at ?? task.latest_end ?? task.earliest_start;
  return value && Number.isFinite(Date.parse(value)) ? value : null;
};
const stamp = (task: Candidate) => {
  const value = moment(task);
  return value ? toSeoulInput(value) : null;
};

export function PlanningTaskPicker({
  selected,
  onChange,
  onEdit,
  replaceExisting = false,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  onEdit: () => void;
  replaceExisting?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [extra, setExtra] = useState<{
    query: string;
    base: Page;
    entries: Candidate[];
    has_more: boolean;
    offset: number;
  } | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const inFlight = useRef<AbortController | null>(null);
  const requestKey = useRef(query);
  const panel = useId();
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    requestKey.current = query;
    inFlight.current?.abort();
    return () => inFlight.current?.abort();
  }, [query]);
  const tasks = useResource(
    useCallback(
      (signal: AbortSignal) =>
        api<Page>(
          `/api/scheduling/tasks?${new URLSearchParams({ q: query, ...(replaceExisting ? { replace_existing: "true" } : {}) })}`,
          { signal },
        ),
      [query, replaceExisting],
    ),
  );
  const close = () => setOpen(false);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [open]);
  const currentExtra =
    extra?.query === query && extra.base === tasks.data ? extra : null;
  const entries = [
    ...(tasks.data?.entries ?? []),
    ...(currentExtra?.entries ?? []),
  ];
  const sorted = [...new Map(entries.map((t) => [t.id, t])).values()].sort(
    (a, b) =>
      (moment(a) ? Date.parse(moment(a)!) : Infinity) -
        (moment(b) ? Date.parse(moment(b)!) : Infinity) ||
      korean.compare(a.title, b.title) ||
      a.id.localeCompare(b.id),
  );
  const groups = new Map<string, Candidate[]>();
  for (const task of sorted) {
    const date = stamp(task)?.slice(0, 10) ?? "날짜 미정";
    groups.set(date, [...(groups.get(date) ?? []), task]);
  }
  const hasMore = currentExtra?.has_more ?? tasks.data?.has_more;
  const waiting = search.trim() !== query;
  return (
    <div
      className="planning-picker"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.preventDefault();
          e.stopPropagation();
          close();
          input.current?.focus();
        }
      }}
    >
      <label htmlFor={`${panel}-search`}>할 일 제목 검색</label>
      <div className="planning-picker-bar">
        <input
          ref={input}
          id={`${panel}-search`}
          role="combobox"
          type="search"
          autoComplete="off"
          placeholder="제목을 검색하거나 목록에서 선택하세요"
          aria-expanded={open}
          aria-controls={panel}
          aria-haspopup="dialog"
          value={search}
          maxLength={255}
          onFocus={(e) => {
            if (!root.current?.contains(e.relatedTarget as Node | null))
              setOpen(true);
          }}
          onClick={() => setOpen(true)}
          onChange={(e) => {
            setSearch(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              root.current
                ?.querySelector<HTMLInputElement>(
                  ".planning-picker-panel input",
                )
                ?.focus();
            }
          }}
        />
        <button
          type="button"
          className="secondary"
          aria-label={open ? "할 일 목록 닫기" : "할 일 목록 열기"}
          aria-expanded={open}
          aria-controls={panel}
          onClick={() => setOpen(!open)}
        >
          ⌄
        </button>
        {open && (
          <div
            id={panel}
            role="dialog"
            aria-label="배치할 할 일 선택"
            className="planning-picker-panel"
          >
            <p className="small muted">
              완료 기한 기준 · 기한이 없으면 시작 가능일 · 한국 시간
            </p>
            {tasks.loading || waiting ? (
              <Loading />
            ) : tasks.error ? (
              <>
                <ErrorNotice message={tasks.error} />
                <button
                  type="button"
                  className="secondary"
                  onClick={tasks.reload}
                >
                  다시 시도
                </button>
              </>
            ) : (
              <>
                {!sorted.length && (
                  <p className="notice">
                    검색 결과가 없습니다. 다른 제목을 입력하거나 유동 작업을
                    등록해 주세요.
                  </p>
                )}
                {Array.from(groups, ([date, items]) => (
                  <section
                    key={date}
                    aria-label={date}
                    className="planning-picker-group"
                  >
                    <h3>
                      {date === "날짜 미정"
                        ? date
                        : `${date.slice(0, 4)}년 ${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일`}
                    </h3>
                    <ul className="planning-tasks">
                      {items.map((task) => (
                        <li key={task.id}>
                          <label className="checkbox-row">
                            <input
                              type="checkbox"
                              checked={selected.includes(task.id)}
                              onChange={(e) => {
                                onChange(
                                  e.target.checked
                                    ? [...selected, task.id]
                                    : selected.filter((id) => id !== task.id),
                                );
                                onEdit();
                              }}
                            />
                            <span>
                              {task.title}
                              <small>
                                {stamp(task)?.slice(11) ?? "시간 미정"} ·{" "}
                                {task.estimated_minutes
                                  ? `${task.estimated_minutes}분`
                                  : "소요시간 입력 필요"}{" "}
                                · 우선순위 {task.priority}
                              </small>
                            </span>
                          </label>
                          <Link
                            href={`/tasks/${encodeURIComponent(task.id)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            설정 ↗
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
                {moreError && <ErrorNotice message={moreError} />}
                {hasMore && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={moreBusy}
                    onClick={async () => {
                      if (inFlight.current && !inFlight.current.signal.aborted)
                        return;
                      const controller = new AbortController();
                      inFlight.current = controller;
                      const key = query;
                      setMoreBusy(true);
                      setMoreError("");
                      try {
                        const offset =
                          currentExtra?.offset ??
                          tasks.data?.next_offset ??
                          100;
                        const next = await api<Page>(
                          `/api/scheduling/tasks?${new URLSearchParams({ q: key, offset: String(offset), ...(replaceExisting ? { replace_existing: "true" } : {}) })}`,
                          { signal: controller.signal },
                        );
                        if (
                          !controller.signal.aborted &&
                          requestKey.current === key &&
                          tasks.data
                        )
                          setExtra({
                            query: key,
                            base: tasks.data,
                            entries: [
                              ...(currentExtra?.entries ?? []),
                              ...next.entries,
                            ],
                            has_more: next.has_more,
                            offset: next.next_offset ?? offset + 100,
                          });
                      } catch (error) {
                        if (
                          !controller.signal.aborted &&
                          requestKey.current === key
                        )
                          setMoreError(errorMessage(error));
                      } finally {
                        if (inFlight.current === controller) {
                          inFlight.current = null;
                          setMoreBusy(false);
                        }
                      }
                    }}
                  >
                    {moreBusy ? "불러오는 중…" : "할 일 더 보기"}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
      <p className="small">
        {selected.length}개 선택{" "}
        <button
          type="button"
          className="text-button"
          onClick={() => {
            onChange([]);
            onEdit();
          }}
        >
          선택 해제
        </button>
      </p>
    </div>
  );
}
