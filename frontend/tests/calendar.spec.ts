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
      new URL(r.url()).searchParams.has("start_from"),
  );
  await page.goto("/calendar?date=2026-11-01");
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

test("existing tasks can be placed, edited and deleted without changing task data", async ({
  page,
}) => {
  await calendarApi(page);
  await login(page);
  await page.goto(`/tasks/${calendarTask.id}`);
  const placements = page.getByRole("region", {
    name: "캘린더 배치",
    exact: true,
  });
  await placements
    .getByRole("button", { name: "캘린더에 배치", exact: true })
    .click();
  const form = placements.locator("form");
  await expect(form.getByLabel("배치 시작", { exact: true })).toHaveValue(
    "2026-11-01T09:00",
  );
  const create = page.waitForRequest((r) => r.method() === "POST");
  await form
    .getByRole("button", { name: "캘린더에 배치", exact: true })
    .click();
  expect((await create).postDataJSON()).toEqual({
    task_id: calendarTask.id,
    start_at: "2026-11-01T00:00:00.000Z",
    end_at: "2026-11-01T01:00:00.000Z",
    status: "approved",
  });
  await expect(placements.getByRole("listitem")).toHaveCount(1);
  await placements.getByRole("link", { name: "배치 날짜 보기 →" }).click();
  await expect(page.locator(".calendar-agenda")).toContainText(
    calendarTask.title,
  );
  await page.reload();
  await expect(page.locator(".calendar-agenda > li")).toHaveCount(1);
  await page.getByRole("link", { name: "일정 상세 · 배치 관리 →" }).click();
  await placements
    .getByRole("button", { name: "배치 수정", exact: true })
    .click();
  await form.getByLabel("배치 시작", { exact: true }).fill("2026-11-02T14:00");
  await form.getByLabel("배치 종료", { exact: true }).fill("2026-11-02T15:00");
  const update = page.waitForRequest((r) => r.method() === "PATCH");
  await form.getByRole("button", { name: "배치 변경 저장" }).click();
  expect((await update).postDataJSON()).toEqual({
    start_at: "2026-11-02T05:00:00.000Z",
    end_at: "2026-11-02T06:00:00.000Z",
    status: "approved",
  });
  await expect(placements.locator("time").first()).toHaveAttribute(
    "datetime",
    "2026-11-02T05:00:00.000Z",
  );
  await expect(page.locator(".task-detail time").first()).toHaveAttribute(
    "datetime",
    calendarTask.earliest_start!,
  );
  await placements
    .getByRole("button", { name: "배치 삭제", exact: true })
    .click();
  await placements.getByRole("button", { name: "취소", exact: true }).click();
  await expect(placements.getByRole("listitem")).toHaveCount(1);
  await placements
    .getByRole("button", { name: "배치 삭제", exact: true })
    .click();
  await placements
    .getByRole("button", { name: "배치 삭제 확인", exact: true })
    .click();
  await expect(
    placements.getByText("캘린더에 배치된 시간이 없습니다", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: calendarTask.title, exact: true }),
  ).toBeVisible();
});

test("status-only edits preserve timestamp precision and synced placements are read only", async ({
  page,
}) => {
  await calendarApi(page, [
    { ...calendarEvent, status: "recommended", is_user_approved: false },
    {
      ...calendarEvent,
      id: "synced",
      status: "synced",
      google_event_id: "test-only-event",
    },
  ]);
  await login(page);
  await page.goto(`/tasks/${calendarTask.id}`);
  const placements = page.getByRole("region", {
    name: "캘린더 배치",
    exact: true,
  });
  await expect(
    placements.getByRole("button", { name: "배치 수정", exact: true }),
  ).toHaveCount(1);
  await expect(
    placements.getByText("동기화된 일정은 여기서 변경할 수 없습니다."),
  ).toBeVisible();
  await placements
    .getByRole("button", { name: "배치 수정", exact: true })
    .click();
  await placements.getByLabel("배치 상태").selectOption("cancelled");
  const sent = page.waitForRequest((r) => r.method() === "PATCH");
  await placements.getByRole("button", { name: "배치 변경 저장" }).click();
  expect((await sent).postDataJSON()).toEqual({
    start_at: calendarEvent.start_at,
    end_at: calendarEvent.end_at,
    status: "cancelled",
  });
  await expect(placements.getByText("취소", { exact: true })).toBeVisible();
});

test("validation and 422 errors preserve inputs and pending saves cannot be clicked twice", async ({
  page,
}) => {
  await calendarApi(page);
  await login(page);
  await page.goto(`/tasks/${calendarTask.id}`);
  const placements = page.getByRole("region", {
    name: "캘린더 배치",
    exact: true,
  });
  await placements
    .getByRole("button", { name: "캘린더에 배치", exact: true })
    .click();
  const form = placements.locator("form");
  await form.getByLabel("배치 종료").fill("2026-11-01T08:00");
  await form
    .getByRole("button", { name: "캘린더에 배치", exact: true })
    .click();
  await expect(form.getByRole("alert")).toContainText(
    "배치 종료는 시작보다 늦어야 합니다.",
  );
  await form.getByLabel("배치 종료").fill("2026-11-01T10:00");
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  await page.route("**/test-api/api/scheduled-events", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    calls++;
    await pending;
    await route.fulfill({
      status: 422,
      json: { detail: "[테스트] 배치 검증 오류" },
    });
  });
  await form
    .getByRole("button", { name: "캘린더에 배치", exact: true })
    .click();
  try {
    await expect(form.getByRole("button", { name: "저장 중…" })).toBeDisabled();
    expect(calls).toBe(1);
  } finally {
    release();
  }
  await expect(form.getByRole("alert")).toContainText(
    "[테스트] 배치 검증 오류",
  );
  await expect(form.getByLabel("배치 시작")).toHaveValue("2026-11-01T09:00");
  await page.unroute("**/test-api/api/scheduled-events");
  await form
    .getByRole("button", { name: "캘린더에 배치", exact: true })
    .click();
  await expect(placements.getByRole("listitem")).toHaveCount(1);
});

test("uncertain creation responses lock resubmission and allow checking the saved placement", async ({
  page,
}) => {
  const events = await calendarApi(page);
  await login(page);
  await page.goto(`/tasks/${calendarTask.id}`);
  const placements = page.getByRole("region", {
    name: "캘린더 배치",
    exact: true,
  });
  await placements
    .getByRole("button", { name: "캘린더에 배치", exact: true })
    .click();
  await page.route("**/test-api/api/scheduled-events", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    events.push({ ...calendarEvent, id: "saved-before-disconnect" });
    await route.abort("failed");
  });
  await placements
    .locator("form")
    .getByRole("button", { name: "캘린더에 배치", exact: true })
    .click();
  await expect(placements.getByRole("alert")).toContainText(
    "저장 여부가 불확실",
  );
  await expect(
    placements
      .locator("form")
      .getByRole("button", { name: "캘린더에 배치", exact: true }),
  ).toBeDisabled();
  await placements
    .getByRole("button", { name: "배치 내역 다시 불러오기" })
    .click();
  await expect(placements.getByRole("listitem")).toHaveCount(1);
  await expect(placements.getByLabel("배치 시작")).toHaveValue(
    "2026-11-01T09:00",
  );
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
  await expect(
    page.getByRole("button", { name: "2026년 11월 1일 일요일", exact: true }),
  ).toContainText("101");
  await expect(page.locator(".calendar-agenda > li")).toHaveCount(20);
  for (let i = 0; i < 5; i++)
    await page.getByRole("button", { name: "다음 일정", exact: true }).click();
  await expect(page.locator(".calendar-agenda > li")).toHaveCount(1);
});

test("404 and 409 errors are explained; calendar access and expired sessions are protected", async ({
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
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "서버 API가 아직 제공되지 않을 수 있습니다",
  );
  await expect(
    page.getByText("선택한 날짜에 배치된 일정이 없습니다", { exact: true }),
  ).toHaveCount(0);
  await page.unroute("**/test-api/api/scheduled-events?**");
  await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect(page.locator(".calendar-agenda > li")).toHaveCount(1);
  await page.goto(`/tasks/${calendarTask.id}`);
  const placements = page.getByRole("region", {
    name: "캘린더 배치",
    exact: true,
  });
  await page.route(
    `**/test-api/api/scheduled-events/${calendarEvent.id}`,
    (route) => route.fulfill({ status: 409, json: { detail: "Synced event" } }),
  );
  await placements
    .getByRole("button", { name: "배치 삭제", exact: true })
    .click();
  await placements
    .getByRole("button", { name: "배치 삭제 확인", exact: true })
    .click();
  await expect(placements.getByRole("alert")).toContainText(
    "동기화된 일정은 이 화면에서 변경할 수 없습니다",
  );
  await page.route("**/test-api/api/scheduled-events?**", (route) =>
    route.fulfill({ status: 401, json: { detail: "Unauthorized" } }),
  );
  await page.goto("/calendar");
  await expect(page).toHaveURL(/\/login$/);
  expect(
    await page.evaluate(() => sessionStorage.getItem("plancatch.access_token")),
  ).toBeNull();
});
