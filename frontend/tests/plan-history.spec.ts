import { expect, test } from "@playwright/test";
import { login, mockApi } from "./fixtures";
import { calendarApi, calendarEvent, calendarTask } from "./calendar-fixtures";

const entry = (id: string, state = "approved") => ({
  id,
  state,
  created_at: "2026-11-10T03:00:00Z",
  expires_at: "2026-11-10T03:15:00Z",
  approved_at: state === "approved" ? "2026-11-10T03:01:00Z" : null,
  blocked: false,
  start_at: "2026-11-15T15:00:00Z",
  end_at: "2026-11-16T15:00:00Z",
  task_titles: [`보고서 ${id}`],
  task_count: 1,
  block_count: 2,
  unplaced_count: 0,
  saved_state:
    state === "approved"
      ? {
          active_count: 0,
          changed_count: 1,
          deleted_count: 2,
          inactive_count: 0,
        }
      : null,
});
const receipt = (approved = true) => ({
  id: "saved-plan",
  request: {
    start_at: "2026-11-15T15:00:00Z",
    end_at: "2026-11-16T15:00:00Z",
    include_google: false,
  },
  blocks: [
    {
      id: "old-block",
      task_id: "old-task",
      title: "보고서 준비",
      start_at: "2026-11-16T01:00:00Z",
      end_at: "2026-11-16T02:00:00Z",
    },
  ],
  details: {
    blocked: false,
    warnings: [],
    google_state: "excluded",
    unplaced: [],
    tasks: [
      {
        id: "old-task",
        title: "보고서 준비",
        minutes: 60,
        limit: "2026-11-16T15:00:00Z",
        priority: 3,
        uses_safety_deadline: false,
      },
    ],
  },
  expires_at: "2000-01-01T00:00:00Z",
  approved_at: approved ? "2026-11-10T03:01:00Z" : null,
  approved_event_ids: approved ? ["old-block"] : [],
});

test("history pages, filters and refresh are read only and reflect changed/deleted blocks", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  let gets = 0,
    writes = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/scheduling") && r.method() !== "GET") writes++;
  });
  await page.route("**/test-api/api/scheduling/plans?*", (route) => {
    gets++;
    const q = new URL(route.request().url()).searchParams;
    if (q.get("state") === "expired")
      return route.fulfill({
        json: { entries: [entry("expired", "expired")], next_cursor: null },
      });
    return route.fulfill({
      json: q.has("before_id")
        ? { entries: [entry("older")], next_cursor: null }
        : {
            entries: [entry("latest")],
            next_cursor: { created_at: "2026-11-10T03:00:00Z", id: "latest" },
          },
    });
  });
  await page.goto("/planning/history");
  const region = page.getByRole("region", {
    name: "배치 기록 목록",
    exact: true,
  });
  await expect(region).toContainText("현재 캘린더에 표시되는 배치 0개");
  await expect(region).toContainText("시간 변경 1개 · 삭제 2개");
  await expect(
    region.getByRole("heading", { name: "보고서 latest", exact: true }),
  ).toBeVisible();
  await region.getByRole("button", { name: "다음 기록", exact: true }).click();
  await expect(region).toContainText("보고서 older");
  await expect(region).toContainText("2페이지");
  await expect(
    region.getByRole("button", { name: "다음 기록", exact: true }),
  ).toBeDisabled();
  await region.getByRole("button", { name: "이전 기록", exact: true }).click();
  await expect(region).toContainText("보고서 latest");
  await region.getByLabel("기록 상태", { exact: true }).selectOption("expired");
  await expect(region).toContainText("유효 시간 지남");
  await expect(region).toContainText("1페이지");
  await expect(
    region.getByRole("link", { name: "만료된 기록 보기", exact: true }),
  ).toHaveAttribute("href", "/planning?plan=expired");
  await region.getByRole("button", { name: "새로고침", exact: true }).click();
  await expect(region).toContainText("보고서 expired");
  expect(gets).toBe(5);
  expect(writes).toBe(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await region.screenshot({ path: test.info().outputPath("history.png") });
});

test("history errors retry and empty filters have no leftover rows", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  let calls = 0;
  await page.route("**/test-api/api/scheduling/plans?*", (route) => {
    calls++;
    return calls === 1
      ? route.fulfill({
          status: 503,
          json: { detail: "기록을 불러오지 못했습니다." },
        })
      : route.fulfill({ json: { entries: [], next_cursor: null } });
  });
  await page.goto("/planning/history");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "기록을 불러오지 못했습니다.",
  );
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await expect(page.getByRole("main")).toContainText(
    "해당 상태의 배치 기록이 없습니다.",
  );
  await expect(
    page.getByRole("button", { name: "다음 기록", exact: true }),
  ).toBeDisabled();
});

test("approved history reopens receipt and current placement management without approving or recreating deleted blocks", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  let writes = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/scheduling") && r.method() !== "GET") writes++;
  });
  await page.route("**/test-api/api/scheduling/plans?*", (route) =>
    route.fulfill({
      json: { entries: [entry("saved-plan")], next_cursor: null },
    }),
  );
  await page.route("**/test-api/api/scheduling/plans/saved-plan", (route) =>
    route.fulfill({ json: receipt() }),
  );
  await page.route("**/test-api/api/scheduling/tasks?*", (route) =>
    route.fulfill({ json: { entries: [], has_more: false } }),
  );
  await page.route("**/test-api/api/tasks/old-task", (route) =>
    route.fulfill({
      json: {
        id: "old-task",
        title: "보고서 준비",
        schedule_type: "flexible",
        estimated_minutes: 60,
        priority: 3,
        is_completed: false,
      },
    }),
  );
  await page.route("**/test-api/api/scheduled-events?*", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.goto("/planning/history");
  await page
    .getByRole("link", { name: "기록 보기 · 배치 관리", exact: true })
    .click();
  const result = page.getByRole("region", {
    name: "자동 배치 미리보기",
    exact: true,
  });
  await expect(result).toContainText("아래 시간은 승인 당시 기록입니다.");
  await result
    .getByLabel("관리할 할 일", { exact: true })
    .selectOption("old-task");
  await expect(result).toContainText("캘린더에 배치된 시간이 없습니다");
  await expect(
    result.getByRole("button", { name: "선택한 배치 승인", exact: true }),
  ).toHaveCount(0);
  expect(writes).toBe(0);
});

test("expired preview can only be read and never sends an approval", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  let writes = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/scheduling") && r.method() !== "GET") writes++;
  });
  await page.route("**/test-api/api/scheduling/tasks?*", (route) =>
    route.fulfill({ json: { entries: [], has_more: false } }),
  );
  await page.route("**/test-api/api/scheduling/plans/saved-plan", (route) =>
    route.fulfill({ json: receipt(false) }),
  );
  await page.goto("/planning?plan=saved-plan");
  const result = page.getByRole("region", {
    name: "자동 배치 미리보기",
    exact: true,
  });
  await expect(
    result.getByRole("heading", {
      name: "유효 시간이 지난 미리보기",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    result.getByLabel("보고서 준비 1 시작", { exact: true }),
  ).toBeDisabled();
  await expect(
    result.getByRole("button", { name: "선택한 배치 승인", exact: true }),
  ).toBeDisabled();
  expect(writes).toBe(0);
  await expect(
    page.getByRole("link", { name: "배치 기록", exact: true }),
  ).toHaveAttribute("href", "/planning/history");
});

test("history management edits then deletes an existing placement and refreshes current counts", async ({
  page,
}) => {
  await calendarApi(page, [calendarEvent]);
  await login(page);
  let edits = 0,
    deletes = 0,
    approvals = 0;
  page.on("request", (r) => {
    if (r.url().includes("/scheduled-events/") && r.method() === "PATCH")
      edits++;
    if (r.url().includes("/scheduled-events/") && r.method() === "DELETE")
      deletes++;
    if (r.url().includes("/approve")) approvals++;
  });
  const saved = receipt();
  saved.blocks = [
    { ...saved.blocks[0], id: calendarEvent.id, task_id: calendarTask.id },
  ];
  saved.details.tasks = [{ ...saved.details.tasks[0], id: calendarTask.id }];
  await page.route("**/test-api/api/scheduling/plans/saved-plan", (r) =>
    r.fulfill({ json: saved }),
  );
  await page.route("**/test-api/api/scheduling/tasks?*", (r) =>
    r.fulfill({ json: { entries: [], has_more: false } }),
  );
  await page.route("**/test-api/api/scheduling/plans?*", (r) =>
    r.fulfill({
      json: {
        entries: [
          {
            ...entry("saved-plan"),
            block_count: 1,
            saved_state: {
              active_count: deletes ? 0 : 1,
              changed_count: edits && !deletes ? 1 : 0,
              deleted_count: deletes,
              inactive_count: 0,
            },
          },
        ],
        next_cursor: null,
      },
    }),
  );
  await page.goto("/planning?plan=saved-plan");
  const result = page.getByRole("region", {
    name: "자동 배치 미리보기",
    exact: true,
  });
  await result
    .getByLabel("관리할 할 일", { exact: true })
    .selectOption(calendarTask.id);
  await result.getByRole("button", { name: "배치 수정", exact: true }).click();
  await result
    .getByLabel("배치 시작", { exact: true })
    .fill("2026-11-16T14:00");
  await result
    .getByLabel("배치 종료", { exact: true })
    .fill("2026-11-16T15:00");
  await result
    .getByRole("button", { name: "배치 변경 저장", exact: true })
    .click();
  await expect(result).toContainText("캘린더 배치를 저장했습니다.");
  expect(edits).toBe(1);
  await result.getByRole("button", { name: "배치 삭제", exact: true }).click();
  await result
    .getByRole("button", { name: "배치 삭제 확인", exact: true })
    .click();
  await expect(result).toContainText("캘린더에 배치된 시간이 없습니다");
  expect(deletes).toBe(1);
  await result
    .getByRole("link", { name: "전체 배치 기록 →", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "배치 기록 목록", exact: true }),
  ).toContainText("현재 캘린더에 표시되는 배치 0개 · 시간 변경 0개 · 삭제 1개");
  expect(approvals).toBe(0);
});
