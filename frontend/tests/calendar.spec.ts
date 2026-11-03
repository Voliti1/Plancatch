import { test, expect } from "@playwright/test";
import { login } from "./fixtures";
import { calendarApi, calendarEvent, calendarTask } from "./calendar-fixtures";

test("month and week views use Seoul overlap boundaries and hide cancelled placements", async ({
  page,
}) => {
  await calendarApi(page, [
    calendarEvent,
    {
      ...calendarEvent,
      id: "cross-midnight",
      start_at: "2026-10-31T14:30:00Z",
      end_at: "2026-10-31T15:30:00Z",
    },
    {
      ...calendarEvent,
      id: "ends-midnight",
      start_at: "2026-10-31T14:00:00Z",
      end_at: "2026-10-31T15:00:00Z",
    },
    {
      ...calendarEvent,
      id: "cancelled",
      status: "cancelled",
      is_user_approved: false,
    },
  ]);
  await login(page);
  const sent = page.waitForRequest(
    (r) =>
      r.url().includes("/scheduled-events?") &&
      new URL(r.url()).searchParams.get("end_before") ===
        "2026-12-12T15:00:00.000Z",
  );
  await page.goto("/calendar?date=2026-11-01");
  await page.getByRole("button", { name: "월간", exact: true }).click();
  const params = new URL((await sent).url()).searchParams;
  expect(params.get("start_from")).toBe("2026-10-31T15:00:00.000Z");
  expect(params.get("end_before")).toBe("2026-12-12T15:00:00.000Z");
  await expect(page.locator(".calendar-agenda > li")).toHaveCount(2);
  await expect(page.locator(".calendar-agenda")).toContainText("오전 9:00");
  await page.getByLabel("취소한 배치 포함").check();
  await expect(page.locator(".calendar-agenda > li")).toHaveCount(3);
  await page.getByRole("button", { name: "주간", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "주간 날짜" }).getByRole("button"),
  ).toHaveCount(7);
  await page.getByRole("button", { name: "월간", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "월간 날짜" }).getByRole("button"),
  ).toHaveCount(42);
  await page.getByRole("heading", { name: "캘린더", exact: true }).click();
  await page.screenshot({
    path: test.info().outputPath("calendar.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("task detail has no placement controls or placement requests; existing placements remain visible on calendar", async ({
  page,
}) => {
  await calendarApi(page, [calendarEvent]);
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/scheduled-events")) requests.push(r.method());
  });
  await login(page);
  await page.goto(`/tasks/${calendarTask.id}`);
  await expect(
    page.getByRole("heading", { name: calendarTask.title, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "캘린더 배치", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "캘린더에 배치", exact: true }),
  ).toHaveCount(0);
  expect(requests).toEqual([]);
  await page.goto("/calendar?date=2026-11-01");
  await page.getByRole("button", { name: "월간", exact: true }).click();
  await expect(page.locator(".calendar-agenda > li")).toHaveCount(1);
  await page.getByRole("link", { name: "상세, 수정 →", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${calendarTask.id}$`));
  expect(requests.every((method) => method === "GET")).toBe(true);
});

test("pagination loads the second API page and lets users browse busy days", async ({
  page,
}) => {
  await calendarApi(
    page,
    Array.from({ length: 101 }, (_, i) => ({
      ...calendarEvent,
      id: `event-${i}`,
    })),
  );
  await login(page);
  await page.goto("/calendar?date=2026-11-01");
  await page.getByRole("button", { name: "월간", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "2026년 11월 1일 일요일", exact: true }),
  ).toContainText("101");
  await expect(page.locator(".calendar-agenda > li")).toHaveCount(20);
  for (let i = 0; i < 5; i++)
    await page.getByRole("button", { name: "다음 일정", exact: true }).click();
  await expect(page.locator(".calendar-agenda > li")).toHaveCount(1);
});

test("read errors are explained; calendar access and expired sessions are protected", async ({
  page,
}) => {
  await calendarApi(page, [calendarEvent]);
  await page.goto("/calendar");
  await expect(page).toHaveURL(/\/login$/);
  await login(page);
  await page.route("**/test-api/api/scheduled-events?**", (route) =>
    route.fulfill({ status: 404, json: { detail: "Not found" } }),
  );
  await page.goto("/calendar?date=2026-11-01");
  await page.getByRole("button", { name: "월간", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "서버 API가 아직 제공되지 않을 수 있습니다",
  );
  await expect(
    page.getByText("선택한 날짜에 배치된 일정이 없습니다", { exact: true }),
  ).toHaveCount(0);
  await page.unroute("**/test-api/api/scheduled-events?**");
  await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect(page.locator(".calendar-agenda > li")).toHaveCount(1);
  await page.route("**/test-api/api/scheduled-events?**", (route) =>
    route.fulfill({ status: 401, json: { detail: "Unauthorized" } }),
  );
  await page.goto("/calendar");
  await expect(page).toHaveURL(/\/login$/);
  expect(
    await page.evaluate(() => sessionStorage.getItem("plancatch.access_token")),
  ).toBeNull();
});
