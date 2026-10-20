// Test-only API responses; production calendar code never imports this file.
import { expect, type Page } from "@playwright/test";
import type { ScheduledEvent } from "../types/scheduled-event";
import type { Task } from "../types/task";
import { mockApi } from "./fixtures";

export const calendarTask: Task = {
  id: "calendar-task",
  title: "[테스트] 캘린더 회의",
  description: "[테스트] 회의 메모",
  deadline_id: null,
  earliest_start: "2026-11-01T00:00:00Z",
  latest_end: "2026-11-01T01:00:00Z",
  estimated_minutes: 60,
  priority: 3,
  schedule_type: "fixed",
  is_completed: false,
  completed_at: null,
  created_at: "2026-10-20T00:00:00Z",
  updated_at: "2026-10-20T00:00:00Z",
};
export const calendarEvent: ScheduledEvent = {
  id: "calendar-event",
  task_id: calendarTask.id,
  start_at: "2026-11-01T00:00:45.123Z",
  end_at: "2026-11-01T01:00:10.456Z",
  status: "approved",
  is_user_approved: true,
  google_calendar_id: null,
  google_event_id: null,
  sync_error: null,
  created_at: "2026-10-20T00:00:00Z",
  updated_at: "2026-10-20T00:00:00Z",
};
export async function calendarApi(
  page: Page,
  initial: ScheduledEvent[] = [],
  tasks: Task[] = [calendarTask],
) {
  await mockApi(page, [], { tasks });
  const events = initial.map((event) => ({ ...event }));
  await page.route(
    "**/test-api/api/calendar/registrations?**",
    async (route) => {
      const query = new URL(route.request().url()).searchParams;
      const first = Date.parse(query.get("start_from")!),
        last = Date.parse(query.get("end_before")!);
      const entries = tasks
        .filter(
          (t) =>
            !events.some((e) => e.task_id === t.id) &&
            t.schedule_type === "fixed" &&
            t.earliest_start &&
            t.latest_end &&
            Date.parse(t.earliest_start) < last &&
            Date.parse(t.latest_end) > first,
        )
        .map((t) => ({
          id: t.id,
          kind: "fixed_task",
          title: t.title,
          start_at: t.earliest_start,
          end_at: t.latest_end,
          is_confirmed: true,
          is_completed: t.is_completed,
        }));
      return route.fulfill({ json: { entries, has_more: false } });
    },
  );
  let nextId = 1;
  await page.route("**/test-api/api/scheduled-events**", async (route) => {
    const request = route.request();
    expect(request.headers().authorization).toBe(
      "Bearer test-only-placeholder",
    );
    const url = new URL(request.url());
    const method = request.method();
    if (url.pathname.endsWith("/scheduled-events")) {
      if (method === "POST") {
        const input = request.postDataJSON();
        expect(Object.keys(input).sort()).toEqual([
          "end_at",
          "start_at",
          "status",
          "task_id",
        ]);
        expect(input.status).toBe("approved");
        expect(Date.parse(input.end_at)).toBeGreaterThan(
          Date.parse(input.start_at),
        );
        const event = {
          ...calendarEvent,
          ...input,
          id: `new-event-${nextId++}`,
          is_user_approved: input.status === "approved",
        };
        events.push(event);
        return route.fulfill({ status: 201, json: event });
      }
      const task = url.searchParams.get("task_id");
      const start = url.searchParams.get("start_from");
      const end = url.searchParams.get("end_before");
      const filtered = events
        .filter(
          (event) =>
            (!task || event.task_id === task) &&
            (!start || Date.parse(event.end_at) > Date.parse(start)) &&
            (!end || Date.parse(event.start_at) < Date.parse(end)),
        )
        .sort(
          (a, b) =>
            Date.parse(a.start_at) - Date.parse(b.start_at) ||
            a.id.localeCompare(b.id),
        );
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 50);
      return route.fulfill({ json: filtered.slice(offset, offset + limit) });
    }
    const id = decodeURIComponent(url.pathname.split("/").pop()!);
    const index = events.findIndex((event) => event.id === id);
    if (index < 0)
      return route.fulfill({
        status: 404,
        json: { detail: "Scheduled event not found" },
      });
    if (
      method !== "GET" &&
      (events[index].status === "synced" || events[index].google_event_id)
    )
      return route.fulfill({
        status: 409,
        json: { detail: "Use calendar synchronization" },
      });
    if (method === "DELETE") {
      events.splice(index, 1);
      return route.fulfill({ status: 204 });
    }
    if (method === "PATCH") {
      const input = request.postDataJSON();
      expect(Object.keys(input).sort()).toEqual([
        "end_at",
        "start_at",
        "status",
      ]);
      events[index] = {
        ...events[index],
        ...input,
        is_user_approved: input.status === "approved",
      };
    }
    return route.fulfill({ json: events[index] });
  });
  return events;
}
