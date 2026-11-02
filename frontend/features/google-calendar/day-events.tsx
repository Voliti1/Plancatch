import { formatSeoul } from "@/lib/date/seoul";
import { googleOnDay, type GoogleEvent } from "./events";

export function GoogleDayEvents({
  events,
  day,
}: {
  events: GoogleEvent[];
  day: string;
}) {
  const rows = events.filter((event) => googleOnDay(event, day));
  return (
    <section className="google-day-events" aria-label="구글 기본 캘린더 일정">
      <h3>
        구글 기본 캘린더 <span className="tag">조회 전용</span>
      </h3>
      {!rows.length ? (
        <p className="muted small">선택한 날짜의 구글 일정이 없습니다.</p>
      ) : (
        <ul className="calendar-agenda">
          {rows.map((event) => (
            <li key={event.id}>
              <strong>{event.title}</strong>
              <p>
                {event.start_date
                  ? "하루 종일"
                  : event.start_at && event.end_at
                    ? `${formatSeoul(event.start_at)} → ${formatSeoul(event.end_at)}`
                    : "시간 확인 필요"}
              </p>
              <span className="tag">Google Calendar</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
