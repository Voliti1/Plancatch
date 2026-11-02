import { test, expect } from "@playwright/test";
import { login } from "./fixtures";
import { calendarApi, calendarEvent } from "./calendar-fixtures";
import {
  googleOnDay,
  withoutLocalDuplicates,
  type GoogleEvent,
} from "../features/google-calendar/events";

const timed: GoogleEvent = {
  id: "google-meeting",
  title: "구글 개인 면접",
  start_at: "2026-11-01T01:00:00Z",
  end_at: "2026-11-01T02:00:00Z",
  start_date: null,
  end_date: null,
};
const allDay: GoogleEvent = {
  id: "google-holiday",
  title: "구글 휴가",
  start_at: null,
  end_at: null,
  start_date: "2026-11-01",
  end_date: "2026-11-03",
};

test("Google calendars are fetched only after opt-in and appear in the calendar without writes", async ({
  page,
}) => {
  await calendarApi(page, [calendarEvent]);
  const calls: string[] = [];
  await page.route("**/google-calendar/events?**", async (route) => {
    const request = route.request(),
      query = new URL(request.url()).searchParams;
    expect(request.method()).toBe("GET");
    expect(request.headers().authorization).toBe(
      "Bearer test-only-placeholder",
    );
    calls.push(request.method());
    expect(query.get("start_from")).toContain("2026-10-31T15:00:00");
    await route.fulfill({
      json: { events: [timed, allDay], has_more: false, skipped_count: 0 },
    });
  });
  await login(page);
  await page.goto("/calendar?date=2026-11-01");
  await expect(
    page.getByText("[테스트] 캘린더 회의", { exact: true }),
  ).toBeVisible();
  expect(calls).toHaveLength(0);
  await page.getByLabel("구글 일정 함께 보기").check();
  const google = page.getByRole("region", { name: "구글 기본 캘린더 일정" });
  await expect(google.getByText(timed.title, { exact: true })).toBeVisible();
  await expect(google.getByText("하루 종일", { exact: true })).toBeVisible();
  await expect(google).toContainText("오전 10:00");
  await expect(
    page.getByRole("button", { name: "2026년 11월 1일 일요일", exact: true }),
  ).toContainText("3개 일정");
  await expect(google.getByRole("button")).toHaveCount(0);
  expect(calls).toEqual(["GET"]);
  await page.screenshot({
    path: test.info().outputPath("google-calendar.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "2026년 11월 2일 월요일", exact: true })
    .click();
  await expect(google.getByText(allDay.title, { exact: true })).toBeVisible();
  await expect(google.getByText(timed.title, { exact: true })).toHaveCount(0);
  expect(calls).toEqual(["GET"]);
  await page
    .getByRole("button", { name: "2026년 11월 1일 일요일", exact: true })
    .click();
  await expect(google.getByText(timed.title, { exact: true })).toBeVisible();
  expect(calls).toEqual(["GET"]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.getByLabel("구글 일정 함께 보기").uncheck();
  await expect(google).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "2026년 11월 1일 일요일", exact: true }),
  ).toContainText("1개 일정");
});

test("Google failures are not an empty calendar and do not hide local events", async ({
  page,
}) => {
  await calendarApi(page, [calendarEvent]);
  await page.route("**/google-calendar/events?**", (route) =>
    route.fulfill({
      status: 409,
      json: { detail: "구글 계정을 다시 연결해 주세요." },
    }),
  );
  await login(page);
  await page.goto("/calendar?date=2026-11-01");
  await page.getByLabel("구글 일정 함께 보기").check();
  await expect(
    page.getByRole("alert").filter({ hasText: "구글 계정을 다시 연결" }),
  ).toBeVisible();
  await expect(
    page.getByText("[테스트] 캘린더 회의", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "구글 계정 연결 설정 →" }),
  ).toHaveAttribute("href", "/settings/google-calendar");
  await expect(
    page.getByText("선택한 날짜의 구글 일정이 없습니다."),
  ).toHaveCount(0);
});

test("late responses stay hidden after opt-out; partial results are labelled", async ({
  page,
}) => {
  await calendarApi(page);
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let began!: () => void;
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  await page.route("**/google-calendar/events?**", async (route) => {
    began();
    await waiting;
    await route.fulfill({
      json: { events: [timed], has_more: true, skipped_count: 2 },
    });
  });
  await login(page);
  await page.goto("/calendar?date=2026-11-01");
  await page.getByLabel("구글 일정 함께 보기").check();
  await started;
  await page.getByLabel("구글 일정 함께 보기").uncheck();
  release();
  await expect(page.getByText(timed.title, { exact: true })).toHaveCount(0);
  await page.unroute("**/google-calendar/events?**");
  await page.route("**/google-calendar/events?**", (route) =>
    route.fulfill({
      json: { events: [timed], has_more: true, skipped_count: 2 },
    }),
  );
  await page.getByLabel("구글 일정 함께 보기").check();
  await expect(page.getByText(/구글 일정은 첫 250건만 표시/)).toBeVisible();
  await expect(
    page.getByText(/시간 형식을 확인할 수 없는 구글 일정 2건/),
  ).toBeVisible();
});

test("all-day end is exclusive; exact synced copies are deduplicated", () => {
  expect(googleOnDay(allDay, "2026-11-01")).toBe(true);
  expect(googleOnDay(allDay, "2026-11-02")).toBe(true);
  expect(googleOnDay(allDay, "2026-11-03")).toBe(false);
  expect(
    withoutLocalDuplicates(
      [timed],
      [
        {
          ...calendarEvent,
          google_calendar_id: "primary",
          google_event_id: timed.id,
          start_at: timed.start_at!,
          end_at: timed.end_at!,
        },
      ],
    ),
  ).toHaveLength(0);
  expect(
    withoutLocalDuplicates(
      [timed],
      [
        {
          ...calendarEvent,
          google_calendar_id: "primary",
          google_event_id: timed.id,
        },
      ],
    ),
  ).toHaveLength(1);
});
