import { test, expect } from "@playwright/test";
import { login } from "./fixtures";
import { calendarApi, calendarEvent, calendarTask } from "./calendar-fixtures";

test("selecting days reuses all three calendar reads; refresh still fetches current data", async ({
  page,
}) => {
  await calendarApi(page, [
    { ...calendarEvent, task_title: calendarTask.title },
  ]);
  const reads = { placements: 0, registrations: 0, google: 0 };
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/scheduled-events")) reads.placements++;
    if (path.endsWith("/calendar/registrations")) reads.registrations++;
    if (path.endsWith("/google-calendar/events")) reads.google++;
  });
  await page.route(
    "**/test-api/api/integrations/google-calendar/events?**",
    (route) =>
      route.fulfill({
        json: { events: [], has_more: false, skipped_count: 0 },
      }),
  );
  await login(page);
  await page.goto("/calendar?date=2026-11-01");
  const refresh = page.getByRole("button", { name: "새로고침", exact: true });
  await expect(page.locator(".calendar-agenda")).toContainText(
    calendarTask.title,
  );
  await page.getByLabel("구글 일정 함께 보기").check();
  await expect(refresh).toBeEnabled();
  const initial = { ...reads };
  expect(initial).toEqual({ placements: 1, registrations: 1, google: 1 });
  const grid = page.getByRole("group", { name: "월간 날짜" });
  await grid
    .getByRole("button", { name: "2026년 11월 2일 월요일", exact: true })
    .click();
  await expect(page.locator("#selected-day-title")).toContainText("11월 2일");
  await grid
    .getByRole("button", { name: "2026년 11월 1일 일요일", exact: true })
    .click();
  await expect(page.locator(".calendar-agenda")).toContainText(
    calendarTask.title,
  );
  expect(reads).toEqual(initial);
  await refresh.click();
  await expect(refresh).toBeEnabled();
  await expect
    .poll(() => reads)
    .toEqual({ placements: 2, registrations: 2, google: 2 });
  await page.getByRole("button", { name: "다음 기간", exact: true }).click();
  await expect(refresh).toBeEnabled();
  await expect
    .poll(() => reads)
    .toEqual({ placements: 3, registrations: 3, google: 3 });
});

test("leaving a calendar range cancels its pending read and never requests its later pages", async ({
  page,
}) => {
  await calendarApi(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const oldPages: string[] = [];
  let aborted = false;
  page.on("requestfailed", (request) => {
    if (
      request.url().includes("/scheduled-events?") &&
      new URL(request.url()).searchParams.get("start_from") ===
        "2026-10-31T15:00:00.000Z"
    )
      aborted = true;
  });
  await page.route("**/test-api/api/scheduled-events?**", async (route) => {
    const query = new URL(route.request().url()).searchParams;
    if (query.get("start_from") !== "2026-10-31T15:00:00.000Z")
      return route.fulfill({ json: [] });
    oldPages.push(query.get("offset")!);
    await gate;
    await route
      .fulfill({
        json: Array.from({ length: 100 }, (_, i) => ({
          ...calendarEvent,
          id: `old-${i}`,
        })),
      })
      .catch(() => {});
  });
  try {
    await login(page);
    await page.goto("/calendar?date=2026-11-01");
    await expect.poll(() => oldPages.length).toBe(1);
    await page.getByRole("button", { name: "다음 기간", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "2026년 12월", exact: true }),
    ).toBeVisible();
    await expect.poll(() => aborted).toBe(true);
    release();
    await expect(
      page.getByRole("button", { name: "새로고침", exact: true }),
    ).toBeEnabled();
    expect(oldPages).toEqual(["0"]);
    await expect(page.locator(".calendar-agenda")).toHaveCount(0);
  } finally {
    release();
  }
});

test("a read with a navigation cancellation signal still has a network timeout", async ({
  page,
}) => {
  await calendarApi(page);
  await login(page);
  await page.addInitScript(() => {
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    AbortSignal.timeout = (milliseconds: number) =>
      timeout(milliseconds === 15000 ? 500 : milliseconds);
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/test-api/api/scheduled-events?**", async (route) => {
    await gate;
    await route.fulfill({ json: [] }).catch(() => {});
  });
  try {
    await page.goto("/calendar?date=2026-11-01");
    await expect(
      page.getByRole("alert").filter({ hasText: "서버에 연결하지 못했습니다" }),
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByRole("button", { name: "새로고침", exact: true }),
    ).toBeEnabled();
  } finally {
    release();
  }
});
