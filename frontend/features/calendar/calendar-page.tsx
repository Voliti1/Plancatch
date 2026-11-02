"use client";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { Empty, ErrorNotice, Loading } from "@/components/feedback";
import { PageHeading } from "@/components/page-heading";
import { useResource } from "@/lib/api/use-resource";
import { useHydrated } from "@/lib/use-hydrated";
import { formatSeoul } from "@/lib/date/seoul";
import type { ScheduledEvent } from "@/types/scheduled-event";
import { tasksApi } from "@/features/tasks/api";
import {
  emptyGoogleEvents,
  googleOnDay,
  readGoogleEvents,
  withoutLocalDuplicates,
} from "@/features/google-calendar/events";
import { GoogleDayEvents } from "@/features/google-calendar/day-events";
import {
  readRegistrations,
  registrationHref,
  registrationOnDay,
  type CalendarRegistration,
} from "./registrations";
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

const emptyRegistrations: CalendarRegistration[] = [];

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
            {event.task_title ? (
              <strong>{event.task_title}</strong>
            ) : (
              <TaskTitle id={event.task_id} />
            )}
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

function RegisteredDay({ entries }: { entries: CalendarRegistration[] }) {
  const [page, setPage] = useState(0);
  if (!entries.length) return null;
  return (
    <div className="registered-day-events">
      <ul className="calendar-agenda">
        {entries.slice(page * 20, (page + 1) * 20).map((item) => (
          <li key={`${item.kind}:${item.id}`}>
            <Link
              href={registrationHref(item)}
              className="registered-event-title"
            >
              {item.title}
            </Link>
            <p>
              <time dateTime={item.start_at}>{formatSeoul(item.start_at)}</time>
              {item.end_at && (
                <>
                  {" "}
                  →{" "}
                  <time dateTime={item.end_at}>{formatSeoul(item.end_at)}</time>
                </>
              )}
            </p>
            <div className="calendar-agenda-actions">
              <span className={`tag registration-${item.kind}`}>
                {item.kind === "deadline" ? "마감일" : "수동 일정"}
              </span>
              <span className="small muted">
                {item.is_completed
                  ? "완료"
                  : !item.is_confirmed
                    ? "확인 필요"
                    : ""}
              </span>
              <Link href={registrationHref(item)}>상세 · 수정 →</Link>
            </div>
          </li>
        ))}
      </ul>
      {entries.length > 20 && (
        <div className="calendar-pagination">
          <button
            className="secondary"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            이전 등록 일정
          </button>
          <span>
            {page + 1} / {Math.ceil(entries.length / 20)} 페이지
          </span>
          <button
            className="secondary"
            disabled={(page + 1) * 20 >= entries.length}
            onClick={() => setPage(page + 1)}
          >
            다음 등록 일정
          </button>
        </div>
      )}
    </div>
  );
}

function CalendarBody({ initialDate }: { initialDate?: string }) {
  const [selected, setSelected] = useState(initialDate ?? todaySeoul);
  const [view, setView] = useState<"month" | "week">("month");
  const [showCancelled, setShowCancelled] = useState(false);
  const [showGoogle, setShowGoogle] = useState(false);
  const anchor =
    view === "month"
      ? `${selected.slice(0, 7)}-01`
      : addDays(selected, -new Date(`${selected}T00:00:00Z`).getUTCDay());
  const days = useMemo(() => calendarDays(anchor, view), [anchor, view]);
  const first = utcMidnight(days[0]);
  const last = utcMidnight(addDays(days[days.length - 1], 1));
  // Selecting another day in the visible range only changes the agenda, not its data.
  const loadGoogle = useCallback(
    (signal: AbortSignal) =>
      showGoogle
        ? readGoogleEvents(first, last, signal)
        : Promise.resolve(emptyGoogleEvents),
    [showGoogle, first, last],
  );
  const google = useResource(loadGoogle);
  function refreshGoogle() {
    google.reload();
  }
  const load = useCallback(
    (signal: AbortSignal) =>
      eventsApi.all(
        {
          start_from: first,
          end_before: last,
        },
        signal,
      ),
    [first, last],
  );
  const { data, loading, error, reload } = useResource(load);
  const loadRegistered = useCallback(
    (signal: AbortSignal) => readRegistrations(first, last, signal),
    [first, last],
  );
  const registrations = useResource(loadRegistered);
  const registered = registrations.data?.entries ?? emptyRegistrations;
  const registeredDay = registered.filter((item) =>
    registrationOnDay(item, selected),
  );
  const events = useMemo(
    () =>
      (data?.events ?? []).filter(
        (event) => showCancelled || event.status !== "cancelled",
      ),
    [data, showCancelled],
  );
  const googleRows = useMemo(
    () =>
      showGoogle
        ? withoutLocalDuplicates(google.data?.events ?? [], events, registered)
        : [],
    [showGoogle, google.data, events, registered],
  );
  const dayBars = useMemo(
    () =>
      days.map((day) => {
        const saved = registered.filter((item) => registrationOnDay(item, day));
        const local = events.filter((event) => onDay(event, day));
        const remote = googleRows.filter((event) => googleOnDay(event, day));
        return {
          day,
          bars: [
            ...saved.map((item) => ({
              key: `${item.kind}:${item.id}`,
              title: item.title,
              kind: item.kind,
            })),
            ...local.map((item) => ({
              key: `placement:${item.id}`,
              title: item.task_title || "플랜캐치 일정",
              kind: item.status === "cancelled" ? "cancelled" : "placement",
            })),
            ...remote.map((item) => ({
              key: `google:${item.id}`,
              title: item.title,
              kind: "google",
            })),
          ],
        };
      }),
    [days, registered, events, googleRows],
  );
  const hasLocalSelected = events.some((event) => onDay(event, selected));
  const today = todaySeoul();
  return (
    <>
      <PageHeading
        eyebrow="MY CALENDAR"
        title="캘린더"
        description="등록한 마감일과 수동 일정을 한국 시간으로 확인하세요."
      />
      <p className="notice small">
        자료에서 등록한 마감일과 시작·종료 시간을 지정한 고정 일정이 표시됩니다.
        별도로 캘린더에 배치할 필요가 없습니다. 구글 일정은 함께 보기만
        지원합니다.
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
          <label className="checkbox">
            <input
              type="checkbox"
              checked={showGoogle}
              onChange={(e) => setShowGoogle(e.target.checked)}
            />
            구글 일정 함께 보기
          </label>
          <button
            className="text-button"
            disabled={
              loading || registrations.loading || (showGoogle && google.loading)
            }
            onClick={() => {
              reload();
              registrations.reload();
              if (showGoogle) refreshGoogle();
            }}
          >
            새로고침
          </button>
        </div>
        {error && <ErrorNotice message={error} retry={reload} />}
        {registrations.error && (
          <ErrorNotice
            message={`등록한 마감일·수동 일정을 불러오지 못했습니다. ${registrations.error}`}
            retry={registrations.reload}
          />
        )}
        {registrations.loading && (
          <p role="status" className="small muted">
            등록 일정 불러오는 중…
          </p>
        )}
        {registrations.data?.has_more && (
          <p role="status">
            등록한 마감일·수동 일정은 종류별 첫 1,000건을 표시합니다. 주간
            보기로 기간을 줄여 주세요.
          </p>
        )}
        {loading && <Loading />}
        {data?.hasMore && (
          <p role="status">
            범위 내 첫 2,000건만 표시했습니다. 주간 보기로 조회 범위를 줄여
            주세요.
          </p>
        )}
        {showGoogle && (
          <div className="google-calendar-status">
            <p className="small muted">
              연결한 구글 기본 캘린더에서 이 기간의 일정만 조회합니다. 개인
              일정은 이 화면에서 변경하지 않습니다.
            </p>
            <Link href="/settings/google-calendar">구글 계정 연결 설정 →</Link>
            {google.loading && <Loading />}
            {google.error && (
              <ErrorNotice message={google.error} retry={refreshGoogle} />
            )}
            {google.data?.has_more && (
              <p role="status">
                구글 일정은 첫 250건만 표시했습니다. 주간 보기로 기간을 줄여
                주세요.
              </p>
            )}
            {Boolean(google.data?.skipped_count) && (
              <p role="status">
                시간 형식을 확인할 수 없는 구글 일정{" "}
                {google.data?.skipped_count}건은 표시하지 않았습니다.
              </p>
            )}
          </div>
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
          {dayBars.map(({ day, bars }) => {
            const count = bars.length;
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
                {count > 0 && (
                  <>
                    <small className="calendar-event-count">
                      {count}
                      <span className="calendar-count-unit">개 일정</span>
                    </small>
                    <span className="calendar-day-bars">
                      {bars.slice(0, 3).map((bar) => (
                        <span
                          key={bar.key}
                          title={bar.title}
                          className={`calendar-event-bar bar-${bar.kind}`}
                        >
                          {bar.title}
                        </span>
                      ))}
                      {count > 3 && (
                        <span className="calendar-more">
                          +{count - 3}개 더 보기
                        </span>
                      )}
                    </span>
                  </>
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
        <RegisteredDay
          key={`${selected}:${registeredDay.map((item) => item.id).join(",")}`}
          entries={registeredDay}
        />
        {loading ? (
          <Loading />
        ) : error ? (
          <p className="muted">
            위의 오류를 해결한 뒤 배치 내역을 확인해 주세요.
          </p>
        ) : registeredDay.length &&
          !hasLocalSelected ? null : !hasLocalSelected &&
          (registrations.loading || registrations.error) ? (
          <p className="small muted">
            등록 일정의 조회 상태를 위에서 확인해 주세요.
          </p>
        ) : (
          <DayEvents
            key={`${selected}:${showCancelled}:${data?.events.map((event) => event.id).join(",")}`}
            events={events}
            day={selected}
          />
        )}
        {showGoogle && !google.loading && !google.error && (
          <GoogleDayEvents events={googleRows} day={selected} />
        )}
      </section>
    </>
  );
}
export function CalendarPage({ initialDate }: { initialDate?: string }) {
  const hydrated = useHydrated();
  return hydrated ? <CalendarBody initialDate={initialDate} /> : <Loading />;
}
