"use client";
import { CategoryBadge } from "@/components/category-badge";
import { useScheduleTime } from "@/features/settings/time-zone";
import Link from "next/link";
import type { CSSProperties } from "react";
import { clockTime } from "@/lib/date/time-zones";
import { dayLabel, todayInZone } from "./dates";
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
  colorFor: (key: string, kind: TimetableEvent["kind"]) => string | undefined;
  busy: boolean;
}) {
  const { formatLocal, zone } = useScheduleTime();
  const week = days.length > 1;
  const {
    scroller,
    preview,
    pointerDown,
    pointerMove,
    pointerUp,
    cancel,
    suppressClick,
  } = useCalendarDrag(busy, !week, zone, onMove);
  const drop = preview?.drop;
  const moving = preview?.event;
  const duration =
    moving?.start && moving.end
      ? (Date.parse(moving.end) - Date.parse(moving.start)) / 60000
      : SLOT_MINUTES;
  return (
    <div className="time-grid-host">
      <section
        ref={scroller}
        className={`time-grid-scroll ${week ? "is-week" : "is-day"}${moving ? " is-dragging" : ""}`}
        aria-label={week ? "주간 시간표" : "하루 시간표"}
      >
        <div
          className="time-grid"
          style={{
            gridTemplateColumns: `var(--time-rail-width) repeat(${days.length}, minmax(0, 1fr))${week ? "" : " var(--time-rail-width)"}`,
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
                aria-current={day === todayInZone(zone) ? "date" : undefined}
                onClick={() => onSelect(day)}
              >
                {`${Number(day.slice(5, 7))}/${Number(day.slice(8))} (${["일", "월", "화", "수", "목", "금", "토"][new Date(day + "T00:00:00Z").getUTCDay()]})`}
              </button>
            ))}
          </div>
          {!week && (
            <div
              aria-hidden="true"
              className="time-grid-corner time-next-day-header"
            />
          )}
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
                      const bounds =
                        click.currentTarget.getBoundingClientRect();
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
          {!week && (
            <div
              aria-hidden="true"
              className="time-all-day time-next-day-all-day"
            />
          )}
          <div
            className="time-axis"
            style={{ height: 24 * HOUR + 24 }}
            data-day-drop-edge={week ? undefined : "previous"}
            data-active={drop?.edge === "previous"}
          >
            {Array.from({ length: 25 }, (_, hour) => (
              <span key={hour} style={{ top: hour * HOUR }}>
                {String(hour).padStart(2, "0")}:00
              </span>
            ))}
            {!week && moving && (
              <div aria-hidden="true" className="time-day-edge-label">
                전날로 이동
              </div>
            )}
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
                    href={slotRegistrationHref(day, minute, zone)}
                    prefetch={false}
                    tabIndex={minute % 60 === 0 ? 0 : -1}
                    aria-label={`${dayLabel(day)} ${clockLabel}에 할 일 등록`}
                  />
                );
              })}
              {layoutDay(events, day, zone).map(
                ({ event, from, to, column, columns }) => {
                  const startText = event.start
                    ? clockTime(new Date(event.start), zone)
                    : "";
                  const endText = event.end
                    ? clockTime(new Date(event.end), zone)
                    : "";
                  const interval = [event.start, event.end]
                    .filter(Boolean)
                    .map((time) => formatLocal(time!))
                    .join(" → ");
                  const content = (
                    <>
                      <strong className="time-event-title">
                        <CategoryBadge value={event.category} compact />
                        {event.title}
                      </strong>
                      <small className="time-event-clock">
                        <span>{startText}</span>
                        {endText && (
                          <span className="time-event-clock-end">
                            <span aria-hidden="true">– </span>
                            {endText}
                          </span>
                        )}
                      </small>
                    </>
                  );
                  const props = {
                    className: `time-event schedule-kind-${event.kind}${event.cancelled ? " is-cancelled" : ""}${canChangeTime(event) ? " is-movable" : ""}${moving?.id === event.id ? " is-moving" : ""}`,
                    style: {
                      top: (from / 60) * HOUR,
                      "--calendar-block-height": `${((to - from) / 60) * HOUR}px`,
                      left: `calc(${(column / columns) * 100}% + 2px)`,
                      width: `calc(${100 / columns}% - 4px)`,
                      backgroundColor: event.target
                        ? colorFor(calendarEventKey(event), event.kind)
                        : undefined,
                    } as CSSProperties,
                    title: `${event.title} · ${interval}`,
                    "aria-label": `${event.title} · ${interval} · ${event.kind === "deadline" ? "마감일" : "할 일"}`,
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
          {!week && (
            <div
              aria-hidden="true"
              className="time-next-day-rail"
              style={{ height: 24 * HOUR + 24 }}
              data-day-drop-edge="next"
              data-active={drop?.edge === "next"}
            >
              {moving && (
                <div className="time-day-edge-label">다음 날로 이동</div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
