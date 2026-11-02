"use client";
import Link from "next/link";
import { dayLabel, todaySeoul } from "./dates";
import { formatSeoul } from "@/lib/date/seoul";
import {
  hourRegistrationHref,
  layoutDay,
  type TimetableEvent,
} from "./time-layout";
import "./time-grid.css";
const HOUR = 56;
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
}: {
  days: string[];
  events: TimetableEvent[];
  selected: string;
  onSelect: (day: string) => void;
}) {
  const week = days.length > 1;
  return (
    <section
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
              {week
                ? `${Number(day.slice(5, 7))}/${Number(day.slice(8))} (${["일", "월", "화", "수", "목", "금", "토"][new Date(day + "T00:00:00Z").getUTCDay()]})`
                : dayLabel(day)}
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
                <div
                  key={event.id}
                  className={`time-all-day-event schedule-kind-${event.kind}`}
                >
                  {event.title}
                </div>
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
            style={{ height: 24 * HOUR }}
            aria-label={`${dayLabel(day)} 시간표`}
          >
            {Array.from({ length: 24 }, (_, hour) => (
              <Link
                className="time-slot"
                key={hour}
                style={{ height: HOUR, top: hour * HOUR }}
                href={hourRegistrationHref(day, hour)}
                aria-label={`${dayLabel(day)} ${String(hour).padStart(2, "0")}:00에 할 일 등록`}
              />
            ))}
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
                  className: `time-event schedule-kind-${event.kind}${event.cancelled ? " is-cancelled" : ""}`,
                  style: {
                    top: (from / 60) * HOUR,
                    height: ((to - from) / 60) * HOUR,
                    left: `calc(${(column / columns) * 100}% + 2px)`,
                    width: `calc(${100 / columns}% - 4px)`,
                  },
                  title: `${event.title} · ${event.start ? formatSeoul(event.start) : ""}`,
                  "aria-label": `${event.title} · ${event.start ? formatSeoul(event.start) : ""} · ${event.kind === "deadline" ? "마감일" : "할 일"}`,
                };
                return event.href ? (
                  <Link key={event.id} {...props} href={event.href}>
                    {content}
                  </Link>
                ) : (
                  <div key={event.id} {...props}>
                    {content}
                  </div>
                );
              },
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
