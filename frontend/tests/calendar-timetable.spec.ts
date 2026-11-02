import { test, expect } from "@playwright/test";
import { mockApi, login } from "./fixtures";
import { calendarTask, calendarEvent } from "./calendar-fixtures";
import {
  layoutDay,
  timetableDays,
  hourRegistrationHref,
} from "../features/calendar/time-layout";

test("time geometry clips midnight, separates overlap and ends at 24:00", () => {
  expect(timetableDays("2026-11-02", "week")).toEqual([
    "2026-11-02",
    "2026-11-03",
    "2026-11-04",
    "2026-11-05",
    "2026-11-06",
    "2026-11-07",
    "2026-11-08",
  ]);
  const rows = layoutDay(
    [
      {
        id: "a",
        kind: "task",
        title: "a",
        start: "2026-11-01T14:00:00Z",
        end: "2026-11-01T16:00:00Z",
      },
      {
        id: "b",
        kind: "task",
        title: "b",
        start: "2026-11-01T15:30:00Z",
        end: "2026-11-01T17:00:00Z",
      },
      {
        id: "c",
        kind: "deadline",
        title: "c",
        start: "2026-11-02T14:59:00Z",
        end: null,
      },
      {
        id: "old",
        kind: "task",
        title: "old",
        start: "2026-11-01T13:00:00Z",
        end: "2026-11-01T15:00:00Z",
      },
    ],
    "2026-11-02",
  );
  expect(rows.map((r) => r.event.id)).toEqual(["a", "b", "c"]);
  expect(rows[0].from).toBe(0);
  expect(rows[0].columns).toBe(2);
  expect(rows[1].column).toBe(1);
  expect(rows[2].to).toBe(1440);
  const url = new URL(
    hourRegistrationHref("2026-11-02", 23),
    "http://localhost",
  );
  expect(url.searchParams.get("start")).toBe("2026-11-02T14:00:00.000Z");
  expect(url.searchParams.get("end")).toBe("2026-11-02T15:00:00.000Z");
});

test("today and week are 24h timetables, consistent colors and editable hour prefill", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-11-02T03:00:00Z") });
  await mockApi(page, [], {
    tasks: [
      {
        ...calendarTask,
        id: "fixed",
        title: "직접 회의",
        earliest_start: "2026-11-02T06:00:00Z",
        latest_end: "2026-11-02T07:00:00Z",
      },
    ],
    deadlines: [
      {
        id: "due",
        title: "지원 마감",
        due_at: "2026-11-02T09:00:00Z",
        description: null,
        source_id: null,
        deadline_type: null,
        confidence: null,
        evidence_text: null,
        is_confirmed: true,
        created_at: "2026-11-01T00:00:00Z",
        updated_at: "2026-11-01T00:00:00Z",
        safe_due_at: null,
        safety_buffer_minutes: null,
      },
    ],
  });
  await page.route("**/test-api/api/scheduled-events?**", (route) =>
    route.fulfill({
      json: [
        {
          ...calendarEvent,
          id: "placed",
          task_id: "placed-task",
          task_title: "배치 회의",
          start_at: "2026-11-02T06:30:00Z",
          end_at: "2026-11-02T07:30:00Z",
        },
      ],
    }),
  );
  await login(page);
  await page.goto("/calendar?date=2026-11-02");
  const bars = page.locator(".calendar-event-bar");
  await expect(bars).toHaveCount(3);
  const color = async (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await color(".calendar-event-bar.bar-fixed_task")).toBe(
    await color(".calendar-event-bar.bar-placement"),
  );
  expect(await color(".calendar-event-bar.bar-deadline")).not.toBe(
    await color(".calendar-event-bar.bar-placement"),
  );
  await page.getByRole("button", { name: "오늘", exact: true }).click();
  const grid = page.getByRole("region", { name: "하루 시간표" });
  await expect(grid).toBeVisible();
  await expect(page.getByRole("group", { name: "월간 날짜" })).toHaveCount(0);
  await expect(
    page
      .getByRole("region", { name: "일정 캘린더", exact: true })
      .getByRole("heading", { name: "2026년 11월 2일 월요일", exact: true }),
  ).toBeVisible();
  await expect(grid.locator(".time-axis span")).toHaveCount(25);
  await expect(grid.getByText("24:00", { exact: true })).toHaveCount(1);
  await expect(grid.locator(".time-event")).toHaveCount(3);
  const boxes = await grid
    .locator(".time-event.schedule-kind-task")
    .evaluateAll((items) =>
      items.map((el) => ({
        left: el.getBoundingClientRect().left,
        width: el.getBoundingClientRect().width,
        color: getComputedStyle(el).color,
      })),
    );
  expect(boxes[0].left).not.toBe(boxes[1].left);
  expect(boxes.every((b) => b.color === "rgb(255, 255, 255)")).toBeTruthy();
  await page.getByRole("button", { name: "주간", exact: true }).click();
  await expect(page.getByRole("region", { name: "주간 시간표" })).toBeVisible();
  await expect(
    page.getByRole("group", { name: "주간 날짜" }).getByRole("button"),
  ).toHaveCount(7);
  await page.getByRole("button", { name: "오늘", exact: true }).click();
  await grid
    .getByRole("link", {
      name: "2026년 11월 2일 월요일 23:00에 할 일 등록",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("시작 일시", { exact: true })).toHaveValue(
    "2026-11-02T23:00",
  );
  await expect(page.getByLabel("종료 일시", { exact: true })).toHaveValue(
    "2026-11-03T00:00",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
