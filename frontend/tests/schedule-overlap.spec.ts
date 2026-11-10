import { expect, test } from "@playwright/test";
import { login, mockApi } from "./fixtures";
import type { Task } from "../types/task";

const result = {
  conflicts: [
    {
      kind: "task",
      id: "existing",
      task_id: "existing",
      title: "기존 주간 회의",
      start_at: "2026-11-16T06:30:00Z",
      end_at: "2026-11-16T07:30:00Z",
      is_recurring: true,
      proposed_start_at: "2026-11-16T06:00:00Z",
      proposed_end_at: "2026-11-16T07:00:00Z",
    },
  ],
  checked_from: "2026-11-16T06:00:00Z",
  checked_until: "2026-11-16T07:00:00Z",
  truncated: false,
  is_recurring: false,
  coverage_limited: false,
  scope: "local",
};
async function open(page: import("@playwright/test").Page) {
  await mockApi(page);
  await login(page);
  await page.goto("/sources/new?mode=manual");
  await page
    .getByRole("textbox", { name: "일정명", exact: true })
    .fill("새 회의");
  await page.getByLabel("시작 일시", { exact: true }).fill("2026-11-16T15:00");
}

test("a conflict requires an explicit save and double click never creates twice", async ({
  page,
}) => {
  await open(page);
  let checks = 0,
    writes = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/tasks")) writes++;
  });
  await page.route("**/test-api/api/schedules/conflicts", (route) => {
    checks++;
    return route.fulfill({ json: result });
  });
  await page.getByRole("button", { name: "일정 등록", exact: true }).click();
  const warning = page.getByRole("region", {
    name: "시간이 겹치는 일정이 있습니다",
    exact: true,
  });
  await expect(warning).toContainText("기존 주간 회의");
  await expect(warning).toContainText("반복 일정");
  expect(checks).toBe(1);
  expect(writes).toBe(0);
  await expect(page.getByLabel("시작 일시", { exact: true })).toHaveValue(
    "2026-11-16T15:00",
  );
  await warning.screenshot({
    path: test.info().outputPath("schedule-overlap.png"),
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await warning
    .getByRole("button", { name: "겹쳐도 저장", exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(page).toHaveURL(/\/tasks\/task-1$/);
  expect(writes).toBe(1);
  expect(checks).toBe(1);
});

test("changing the time clears the old approval and rechecks the new interval", async ({
  page,
}) => {
  await open(page);
  const inputs: Record<string, unknown>[] = [];
  await page.route("**/test-api/api/schedules/conflicts", (route) => {
    inputs.push(route.request().postDataJSON());
    return route.fulfill({
      json: inputs.length === 1 ? result : { ...result, conflicts: [] },
    });
  });
  await page.getByRole("button", { name: "일정 등록", exact: true }).click();
  await page.getByRole("button", { name: "시간 변경", exact: true }).click();
  await expect(page.getByLabel("시작 일시", { exact: true })).toBeFocused();
  await page.getByLabel("시작 일시", { exact: true }).fill("2026-11-16T17:00");
  await expect(
    page.getByRole("button", { name: "겹쳐도 저장", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "일정 등록", exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\/task-1$/);
  expect(inputs).toHaveLength(2);
  expect(inputs[1]).toMatchObject({
    start_at: "2026-11-16T08:00:00.000Z",
    end_at: "2026-11-16T09:00:00.000Z",
  });
});

test("an unavailable check is explicit and can be retried or deliberately bypassed", async ({
  page,
}) => {
  await open(page);
  let writes = 0,
    checks = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/tasks")) writes++;
  });
  await page.route("**/test-api/api/schedules/conflicts", (route) => {
    checks++;
    return route.fulfill({
      status: 503,
      json: { detail: "잠시 후 다시 확인해 주세요." },
    });
  });
  await page.getByRole("button", { name: "일정 등록", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "겹치는 일정을 확인하지 못했습니다",
      exact: true,
    }),
  ).toBeVisible();
  expect(writes).toBe(0);
  await page.getByRole("button", { name: "일정 등록", exact: true }).click();
  expect(checks).toBe(2);
  expect(writes).toBe(0);
  await page
    .getByRole("button", { name: "확인 없이 저장", exact: true })
    .click();
  await expect(page).toHaveURL(/\/tasks\/task-1$/);
  expect(writes).toBe(1);
  expect(checks).toBe(2);
});

test("an edited existing schedule excludes itself and metadata-only changes do not recheck", async ({
  page,
}) => {
  const task: Task = {
    id: "existing",
    deadline_id: null,
    title: "기존 일정",
    description: null,
    estimated_minutes: 60,
    priority: 3,
    schedule_type: "fixed",
    earliest_start: "2026-11-16T06:00:00Z",
    latest_end: "2026-11-16T07:00:00Z",
    is_completed: false,
    completed_at: null,
    created_at: "2026-11-10T00:00:00Z",
    updated_at: "2026-11-10T00:00:00Z",
  };
  await mockApi(page, [], { tasks: [task] });
  await login(page);
  await page.goto("/tasks/existing");
  const inputs: Record<string, unknown>[] = [];
  await page.route("**/test-api/api/schedules/conflicts", (route) => {
    inputs.push(route.request().postDataJSON());
    return route.fulfill({ json: { ...result, conflicts: [] } });
  });
  await page.getByRole("button", { name: "일정 수정", exact: true }).click();
  await page.getByLabel("일정명", { exact: true }).fill("제목만 수정");
  await page
    .getByRole("button", { name: "변경 사항 저장", exact: true })
    .click();
  await expect(
    page.getByText("변경 사항을 저장했습니다.", { exact: true }),
  ).toBeVisible();
  expect(inputs).toHaveLength(0);
  await page.getByRole("button", { name: "일정 수정", exact: true }).click();
  await page.getByLabel("시작 일시", { exact: true }).fill("2026-11-16T17:00");
  await page
    .getByRole("button", { name: "변경 사항 저장", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "일정 수정", exact: true }),
  ).toBeVisible();
  expect(inputs).toHaveLength(1);
  expect(inputs[0].exclude_task_id).toBe("existing");
});

test("truncated results are not presented as a complete conflict-free check", async ({
  page,
}) => {
  await open(page);
  await page.getByLabel("반복 주기", { exact: true }).selectOption("weekly");
  await page.route("**/test-api/api/schedules/conflicts", (route) => {
    expect(route.request().postDataJSON().recurrence.frequency).toBe("weekly");
    return route.fulfill({
      json: {
        ...result,
        conflicts: [],
        truncated: true,
        coverage_limited: true,
        is_recurring: true,
      },
    });
  });
  await page.getByRole("button", { name: "일정 등록", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "일부 일정만 확인했습니다",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "조회 한도에 도달해 일부 일정이나 겹침 내역이 생략됐습니다. 다른 겹침이 있을 수 있습니다.",
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "확인한 범위로 저장", exact: true })
    .click();
  await expect(page).toHaveURL(/\/tasks\/task-1$/);
});
