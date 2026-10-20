"use client";
import Link from "next/link";
import { useCallback, useState } from "react";
import { Empty, ErrorNotice, Loading } from "@/components/feedback";
import { PageHeading } from "@/components/page-heading";
import { useResource } from "@/lib/api/use-resource";
import { useHydrated } from "@/lib/use-hydrated";
import { formatSeoul } from "@/lib/date/seoul";
import type { ScheduledEvent } from "@/types/scheduled-event";
import { tasksApi } from "@/features/tasks/api";
import { eventsApi } from "./api";
import {
  addDays,
  calendarDays,
  dayLabel,
  onDay,
  shiftMonth,
  statusLabel,
  todaySeoul,
  utcMidnight,
} from "./dates";
import "./calendar.css";

function TaskTitle({ id }: { id: string }) {
  const load = useCallback(() => tasksApi.get(id), [id]);
  const { data, error, loading, reload } = useResource(load);
  if (loading)
    return <span className="muted small">일정 제목 불러오는 중…</span>;
  if (error)
    return (
      <ErrorNotice
        message={`연결된 일정 제목을 불러오지 못했습니다. ${error}`}
        retry={reload}
      />
    );
  return <strong>{data?.title}</strong>;
}

function DayEvents({ events, day }: { events: ScheduledEvent[]; day: string }) {
  const [page, setPage] = useState(0);
  const rows = events.filter((event) => onDay(event, day));
  if (!rows.length)
    return (
      <Empty title="선택한 날짜에 배치된 일정이 없습니다">
        일정 상세에서 원하는 시간을 캘린더에 배치해 보세요.
      </Empty>
    );
  return (
    <>
      <ul className="calendar-agenda">
        {rows.slice(page * 20, (page + 1) * 20).map((event) => (
          <li key={event.id}>
            <TaskTitle id={event.task_id} />
            <p>
              <time dateTime={event.start_at}>
                {formatSeoul(event.start_at)}
              </time>
              {" → "}
              <time dateTime={event.end_at}>{formatSeoul(event.end_at)}</time>
            </p>
            <div className="calendar-agenda-actions">
              <span className={`tag event-${event.status}`}>
                {statusLabel[event.status]}
              </span>
              <Link
                href={`/tasks/${encodeURIComponent(event.task_id)}#calendar-placements`}
              >
                일정 상세 · 배치 관리 →
              </Link>
            </div>
            {event.sync_error && (
              <p className="small event-sync-error">
                서버가 기록한 동기화 오류: {event.sync_error}
              </p>
            )}
          </li>
        ))}
      </ul>
      <div className="calendar-pagination">
        <button
          className="secondary"
          disabled={page === 0}
          onClick={() => setPage(page - 1)}
        >
          이전 일정
        </button>
        <span>
          {page + 1} / {Math.ceil(rows.length / 20)} 페이지
        </span>
        <button
          className="secondary"
          disabled={(page + 1) * 20 >= rows.length}
          onClick={() => setPage(page + 1)}
        >
          다음 일정
        </button>
      </div>
    </>
  );
}

function CalendarBody({ initialDate }: { initialDate?: string }) {
  const [selected, setSelected] = useState(initialDate ?? todaySeoul);
  const [view, setView] = useState<"month" | "week">("month");
  const [showCancelled, setShowCancelled] = useState(false);
  const days = calendarDays(selected, view);
  const load = useCallback(() => {
    const range = calendarDays(selected, view);
    return eventsApi.all({
      start_from: utcMidnight(range[0]),
      end_before: utcMidnight(addDays(range[range.length - 1], 1)),
    });
  }, [selected, view]);
  const { data, loading, error, reload } = useResource(load);
  const events = (data?.events ?? []).filter(
    (event) => showCancelled || event.status !== "cancelled",
  );
  const today = todaySeoul();
  return (
    <>
      <PageHeading
        eyebrow="MY CALENDAR"
        title="캘린더"
        description="직접 배치한 일정을 한국 시간으로 확인하세요."
      />
      <p className="notice small">
        PlanCatch 내부 캘린더입니다. 자동 일정 배치와 Google Calendar
        연결·동기화는 아직 지원하지 않습니다.
      </p>
      <section className="card calendar-card" aria-label="일정 캘린더">
        <div className="calendar-toolbar">
          <div className="calendar-period">
            <button
              className="secondary"
              aria-label="이전 기간"
              onClick={() =>
                setSelected(
                  view === "month"
                    ? shiftMonth(selected, -1)
                    : addDays(selected, -7),
                )
              }
            >
              ‹
            </button>
            <h2>
              {view === "month"
                ? `${selected.slice(0, 4)}년 ${Number(selected.slice(5, 7))}월`
                : `${days[0]} ~ ${days[6]}`}
            </h2>
            <button
              className="secondary"
              aria-label="다음 기간"
              onClick={() =>
                setSelected(
                  view === "month"
                    ? shiftMonth(selected, 1)
                    : addDays(selected, 7),
                )
              }
            >
              ›
            </button>
          </div>
          <div className="calendar-view-controls">
            <button
              className="secondary"
              onClick={() => setSelected(todaySeoul())}
            >
              오늘
            </button>
            <div role="group" aria-label="캘린더 보기 방식">
              <button
                className={view === "month" ? "selected" : "secondary"}
                aria-pressed={view === "month"}
                onClick={() => setView("month")}
              >
                월간
              </button>
              <button
                className={view === "week" ? "selected" : "secondary"}
                aria-pressed={view === "week"}
                onClick={() => setView("week")}
              >
                주간
              </button>
            </div>
          </div>
        </div>
        <div className="calendar-options">
          <label>
            기준 날짜
            <input
              type="date"
              value={selected}
              onChange={(e) => {
                if (
                  e.target.value &&
                  /^\d{4}-\d{2}-\d{2}$/.test(e.target.value)
                )
                  setSelected(e.target.value);
              }}
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={showCancelled}
              onChange={(e) => setShowCancelled(e.target.checked)}
            />
            취소한 배치 포함
          </label>
          <button className="text-button" disabled={loading} onClick={reload}>
            새로고침
          </button>
        </div>
        {error && <ErrorNotice message={error} retry={reload} />}
        {loading && <Loading />}
        {data?.hasMore && (
          <p role="status">
            범위 내 첫 2,000건만 표시했습니다. 주간 보기로 조회 범위를 줄여
            주세요.
          </p>
        )}
        <div className="calendar-weekdays" aria-hidden>
          {["일", "월", "화", "수", "목", "금", "토"].map((name) => (
            <span key={name}>{name}</span>
          ))}
        </div>
        <div
          className="calendar-grid"
          role="group"
          aria-label={view === "month" ? "월간 날짜" : "주간 날짜"}
        >
          {days.map((day) => {
            const count = events.filter((event) => onDay(event, day)).length;
            return (
              <button
                key={day}
                type="button"
                className={`calendar-day ${day.slice(0, 7) !== selected.slice(0, 7) ? "outside-month" : ""}`}
                aria-label={dayLabel(day)}
                aria-pressed={day === selected}
                aria-current={day === today ? "date" : undefined}
                onClick={() => setSelected(day)}
              >
                <span>{Number(day.slice(8))}</span>
                {!loading && !error && count > 0 && (
                  <small>
                    {count}
                    <span className="calendar-count-unit">개 일정</span>
                  </small>
                )}
              </button>
            );
          })}
        </div>
      </section>
      <section
        className="card calendar-selected"
        aria-labelledby="selected-day-title"
      >
        <div className="section-header">
          <h2 id="selected-day-title">{dayLabel(selected)}</h2>
          <Link href="/tasks">등록한 일정 보기 →</Link>
        </div>
        {loading ? (
          <Loading />
        ) : error ? (
          <p className="muted">
            위의 오류를 해결한 뒤 배치 내역을 확인해 주세요.
          </p>
        ) : (
          <DayEvents
            key={`${selected}:${showCancelled}:${data?.events.map((event) => event.id).join(",")}`}
            events={events}
            day={selected}
          />
        )}
      </section>
    </>
  );
}
export function CalendarPage({ initialDate }: { initialDate?: string }) {
  const hydrated = useHydrated();
  return hydrated ? <CalendarBody initialDate={initialDate} /> : <Loading />;
}
