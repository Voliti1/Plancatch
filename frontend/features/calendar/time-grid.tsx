"use client";
import Link from "next/link";
import { dayLabel, todaySeoul } from "./dates";
import { formatSeoul } from "@/lib/date/seoul";
import {
  slotRegistrationHref,
  layoutDay,
  type TimetableEvent,
} from "./time-layout";
import { calendarEventKey, canChangeTime } from "./calendar-actions";
import type { CalendarPopupSelection } from "./calendar-event-popup";
import {
  HOUR_HEIGHT as HOUR,
  SLOT_MINUTES,
  useCalendarDrag,
} from "./use-calendar-drag";
import "./time-grid.css";
const clock = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
export function TimeGrid({
  days,
  events,
  selected,
  onSelect,
  onOpen,
  onMove,
  colorFor,
  busy,
}: {
  days: string[];
  events: TimetableEvent[];
  selected: string;
  onSelect: (day: string) => void;
  onOpen: (selection: CalendarPopupSelection) => void;
  onMove: (event: TimetableEvent, start: string, end: string | null) => void;
  colorFor: (key: string) => string | undefined;
  busy: boolean;
}) {
  const week = days.length > 1;
  const {
    scroller,
    preview,
    pointerDown,
    pointerMove,
    pointerUp,
    cancel,
    suppressClick,
  } = useCalendarDrag(busy, onMove);
  const drop = preview?.drop;
  const moving = preview?.event;
  const duration =
    moving?.start && moving.end
      ? (Date.parse(moving.end) - Date.parse(moving.start)) / 60000
      : SLOT_MINUTES;
  return (
    <section
      ref={scroller}
      className={`time-grid-scroll ${week ? "is-week" : "is-day"}`}
      aria-label={week ? "주간 시간표" : "하루 시간표"}
    >
      <div
        className="time-grid"
        style={{
          gridTemplateColumns: `52px repeat(${days.length}, minmax(0, 1fr))`,
        }}
      >
        <div className="time-grid-corner">시간</div>
        <div
          className="time-grid-headings"
          role="group"
          aria-label={week ? "주간 날짜" : "하루 날짜"}
          style={{
            gridColumn: `2 / span ${days.length}`,
            gridTemplateColumns: `repeat(${days.length},minmax(0,1fr))`,
          }}
        >
          {days.map((day) => (
            <button
              key={day}
              className="time-day-heading"
              type="button"
              aria-label={dayLabel(day)}
              aria-pressed={selected === day}
              aria-current={day === todaySeoul() ? "date" : undefined}
              onClick={() => onSelect(day)}
            >
              {`${Number(day.slice(5, 7))}/${Number(day.slice(8))} (${["일", "월", "화", "수", "목", "금", "토"][new Date(day + "T00:00:00Z").getUTCDay()]})`}
            </button>
          ))}
        </div>
        <div className="time-grid-all-day-label">종일</div>
        {days.map((day) => (
          <div key={day} className="time-all-day">
            {events
              .filter(
                (event) =>
                  event.startDate &&
                  event.endDate &&
                  day >= event.startDate &&
                  day < event.endDate,
              )
              .map((event) => (
                <button
                  type="button"
                  key={event.id}
                  className={`time-all-day-event schedule-kind-${event.kind}`}
                  disabled={busy}
                  onClick={(click) => {
                    const bounds = click.currentTarget.getBoundingClientRect();
                    onOpen({
                      event,
                      mode: "detail",
                      x: bounds.left,
                      y: bounds.bottom + 8,
                    });
                  }}
                >
                  {event.title}
                </button>
              ))}
          </div>
        ))}
        <div className="time-axis" style={{ height: 24 * HOUR + 24 }}>
          {Array.from({ length: 25 }, (_, hour) => (
            <span key={hour} style={{ top: hour * HOUR }}>
              {String(hour).padStart(2, "0")}:00
            </span>
          ))}
        </div>
        {days.map((day) => (
          <div
            key={day}
            className="time-day-column"
            data-calendar-day={day}
            style={{ height: 24 * HOUR }}
            aria-label={`${dayLabel(day)} 시간표`}
          >
            {Array.from({ length: 1440 / SLOT_MINUTES }, (_, index) => {
              const minute = index * SLOT_MINUTES;
              const clockLabel = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
              return (
                <Link
                  className={`time-slot${minute % 60 === 0 ? " is-hour" : ""}`}
                  key={minute}
                  style={{ height: HOUR / 4, top: (minute * HOUR) / 60 }}
                  href={slotRegistrationHref(day, minute)}
                  prefetch={false}
                  tabIndex={minute % 60 === 0 ? 0 : -1}
                  aria-label={`${dayLabel(day)} ${clockLabel}에 할 일 등록`}
                />
              );
            })}
            {layoutDay(events, day).map(
              ({ event, from, to, column, columns }) => {
                const content = (
                  <>
                    <strong>{event.title}</strong>
                    <small>
                      {event.start ? clock.format(new Date(event.start)) : ""}
                      {event.end
                        ? ` ~ ${clock.format(new Date(event.end))}`
                        : ""}
                    </small>
                  </>
                );
                const props = {
                  className: `time-event schedule-kind-${event.kind}${event.cancelled ? " is-cancelled" : ""}${canChangeTime(event) ? " is-movable" : ""}${moving?.id === event.id ? " is-moving" : ""}`,
                  style: {
                    top: (from / 60) * HOUR,
                    height: ((to - from) / 60) * HOUR,
                    left: `calc(${(column / columns) * 100}% + 2px)`,
                    width: `calc(${100 / columns}% - 4px)`,
                    backgroundColor: colorFor(calendarEventKey(event)),
                  },
                  title: `${event.title} · ${event.start ? formatSeoul(event.start) : ""}`,
                  "aria-label": `${event.title} · ${event.start ? formatSeoul(event.start) : ""} · ${event.kind === "deadline" ? "마감일" : "할 일"}`,
                };
                return (
                  <button
                    key={event.id}
                    {...props}
                    type="button"
                    disabled={busy}
                    onClick={(click) => {
                      if (suppressClick()) return;
                      const bounds =
                        click.currentTarget.getBoundingClientRect();
                      onOpen({
                        event,
                        mode: "detail",
                        x: bounds.right + 8,
                        y: bounds.top,
                      });
                    }}
                    onContextMenu={(click) => {
                      if (!event.target) return;
                      click.preventDefault();
                      onOpen({
                        event,
                        mode: "menu",
                        x: click.clientX,
                        y: click.clientY,
                      });
                    }}
                    onPointerDown={(pointer) =>
                      pointerDown(pointer, event, day)
                    }
                    onPointerMove={pointerMove}
                    onPointerUp={pointerUp}
                    onPointerCancel={cancel}
                    onLostPointerCapture={cancel}
                    onKeyDown={(key) => {
                      if (key.key === "Escape") cancel();
                    }}
                  >
                    {content}
                  </button>
                );
              },
            )}
            {moving && drop?.day === day && (
              <div
                aria-hidden
                className="time-event time-drop-preview"
                style={{
                  top: (drop.minute * HOUR) / 60,
                  height:
                    (Math.min(
                      1440 - drop.minute,
                      Math.max(SLOT_MINUTES, duration),
                    ) *
                      HOUR) /
                    60,
                }}
              >
                <strong>{moving.title}</strong>
                <small>
                  {String(Math.floor(drop.minute / 60)).padStart(2, "0")}:
                  {String(drop.minute % 60).padStart(2, "0")}
                </small>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
