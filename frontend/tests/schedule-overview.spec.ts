import { test, expect } from "@playwright/test";
import { login, mockApi } from "./fixtures";
import type { Task } from "../types/task";
import type { Deadline } from "../types/api";

const task: Task = {
  id: "test-schedule",
  title: "[테스트] 프로젝트 회의",
  description: "[테스트] 회의실 A\n노트북 준비",
  deadline_id: null,
  earliest_start: "2026-11-06T00:00:45.123Z",
  latest_end: "2026-11-06T01:00:10.456Z",
  schedule_type: "fixed",
  estimated_minutes: null,
  priority: 3,
  is_completed: false,
  completed_at: null,
  created_at: "2026-10-20T00:00:00Z",
  updated_at: "2026-10-20T00:00:00Z",
};
const deadline: Deadline = {
  id: "test-deadline",
  title: "[테스트] 보고서 제출",
  due_at: "2026-11-10T09:00:00Z",
  source_id: null,
  description: null,
  deadline_type: null,
  is_confirmed: true,
  safety_buffer_minutes: null,
  safe_due_at: null,
  confidence: null,
  evidence_text: null,
  created_at: "2026-10-20T00:00:00Z",
  updated_at: "2026-10-20T00:00:00Z",
};

test("dashboard separates deadlines and the five newest schedules, including undated and completed items", async ({
  page,
}) => {
  const tasks = Array.from({ length: 6 }, (_, index) => ({
    ...task,
    id: `test-schedule-${index}`,
    title: `[테스트] 등록 일정 ${index + 1}`,
    earliest_start: index === 1 ? null : task.earliest_start,
    latest_end: index === 1 ? null : task.latest_end,
    schedule_type: index === 1 ? ("flexible" as const) : ("fixed" as const),
    is_completed: index === 2,
    completed_at: index === 2 ? "2026-11-06T01:00:00Z" : null,
  }));
  await mockApi(page, [], { tasks, deadlines: [deadline] });
  await login(page);
  const overview = page.getByRole("region", {
    name: "등록한 일정",
    exact: true,
  });
  await expect(overview.getByRole("listitem")).toHaveCount(5);
  await expect(overview.getByRole("listitem").nth(0)).toContainText(
    "[테스트] 등록 일정 1",
  );
  await expect(overview.getByRole("listitem").nth(1)).toContainText(
    "시작 미정 → 종료 미정",
  );
  await expect(overview.getByRole("listitem").nth(2)).toContainText("완료");
  await expect(
    overview.getByRole("listitem").nth(0).locator("time").nth(0),
  ).toHaveAttribute("datetime", task.earliest_start!);
  await expect(overview.getByRole("listitem").nth(0)).toContainText(
    "오전 9:00",
  );
  await expect(
    overview.getByText("[테스트] 등록 일정 6", { exact: true }),
  ).toHaveCount(0);
  await expect(overview.getByText(deadline.title, { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("link").filter({ hasText: deadline.title }),
  ).toBeVisible();
  await page.getByRole("heading", { name: "등록한 일정", exact: true }).click();
  await page.screenshot({
    path: test.info().outputPath("dashboard-schedules.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await overview
    .getByRole("link", { name: "전체 일정 보기 →", exact: true })
    .click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(
    page.getByRole("link", { name: "[테스트] 등록 일정 6", exact: true }),
  ).toBeVisible();
});

test("manual registration, simple detail editing and completion are reflected on the dashboard after reload", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  const overview = page.getByRole("region", {
    name: "등록한 일정",
    exact: true,
  });
  await expect(
    overview.getByText("등록한 일정이 없습니다", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "새 일정 등록하기 ↗", exact: true })
    .click();
  await page.getByRole("tab", { name: "수동 일정 등록", exact: true }).click();
  await page
    .getByLabel("일정명", { exact: true })
    .fill("[테스트] 직접 입력 회의");
  await page.getByLabel("시작 일시", { exact: true }).fill("2026-11-06T09:00");
  await page.getByLabel("종료 일시", { exact: true }).fill("2026-11-06T10:00");
  await page.getByLabel("메모 (선택)").fill("[테스트] 자료 준비");
  await page.getByRole("button", { name: "일정 등록", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "일정 상세", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("[테스트] 자료 준비", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("우선순위", { exact: true })).toBeHidden();
  await page.getByRole("heading", { name: "일정 상세", exact: true }).click();
  await page.screenshot({
    path: test.info().outputPath("schedule-detail.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "일정 수정", exact: true }).click();
  await expect(page.getByLabel("우선순위", { exact: true })).toBeHidden();
  await page
    .getByLabel("일정명", { exact: true })
    .fill("[테스트] 회의 시간 변경");
  await page.getByLabel("시작 일시", { exact: true }).fill("2026-11-07T14:00");
  await page.getByLabel("종료 일시", { exact: true }).fill("2026-11-07T15:00");
  await page.getByLabel("메모 (선택)").fill("[테스트] 새 회의실");
  const sent = page.waitForRequest((request) => request.method() === "PATCH");
  await page
    .getByRole("button", { name: "변경 사항 저장", exact: true })
    .click();
  expect((await sent).postDataJSON()).toMatchObject({
    title: "[테스트] 회의 시간 변경",
    description: "[테스트] 새 회의실",
    earliest_start: "2026-11-07T05:00:00.000Z",
    latest_end: "2026-11-07T06:00:00.000Z",
    priority: 3,
    schedule_type: "fixed",
    deadline_id: null,
    estimated_minutes: null,
    is_completed: false,
  });
  await expect(
    page.getByText("변경 사항을 저장했습니다.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "[테스트] 회의 시간 변경", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("[테스트] 새 회의실", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "완료 처리", exact: true }).click();
  await expect(
    page.getByText("일정을 완료했습니다.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "← 대시보드", exact: true }).click();
  await expect(overview.getByRole("listitem")).toContainText(
    "[테스트] 회의 시간 변경",
  );
  await expect(overview.getByRole("listitem")).toContainText("완료");
  await expect(overview.locator("time").nth(0)).toHaveAttribute(
    "datetime",
    "2026-11-07T05:00:00.000Z",
  );
  await page.reload();
  await expect(overview.getByRole("listitem")).toHaveCount(1);
});

test("schedule loading and retry do not hide deadline data or misreport an error as an empty list", async ({
  page,
}) => {
  await mockApi(page, [], { deadlines: [deadline] });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/test-api/api/tasks?**", async (route) => {
    await pending;
    await route.fulfill({
      status: 500,
      json: { detail: "[테스트] 일정 조회 실패" },
    });
  });
  await login(page);
  const overview = page.getByRole("region", {
    name: "등록한 일정",
    exact: true,
  });
  try {
    await expect(overview.getByRole("status")).toContainText("불러오는 중");
    await expect(
      page.getByRole("link").filter({ hasText: deadline.title }),
    ).toBeVisible();
  } finally {
    release();
  }
  await expect(overview.getByRole("alert")).toContainText(
    "[테스트] 일정 조회 실패",
  );
  await expect(
    overview.getByText("등록한 일정이 없습니다", { exact: true }),
  ).toHaveCount(0);
  await page.unroute("**/test-api/api/tasks?**");
  await overview
    .getByRole("button", { name: "다시 시도", exact: true })
    .click();
  await expect(
    overview.getByText("등록한 일정이 없습니다", { exact: true }),
  ).toBeVisible();
});

test("legacy undated schedules remain editable without losing optional fields", async ({
  page,
}) => {
  const legacy = {
    ...task,
    earliest_start: null,
    latest_end: null,
    description: null,
    schedule_type: "flexible" as const,
    estimated_minutes: 90,
    priority: 2,
  };
  await mockApi(page, [], { tasks: [legacy] });
  await login(page);
  await page
    .getByRole("region", { name: "등록한 일정", exact: true })
    .getByRole("link")
    .filter({ hasText: task.title })
    .click();
  await expect(
    page.getByText("메모가 없습니다.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "일정 수정", exact: true }).click();
  await expect(page.getByLabel("시작 일시", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("종료 일시", { exact: true })).toHaveValue("");
  await page
    .getByLabel("일정명", { exact: true })
    .fill("[테스트] 날짜 없는 일정 수정");
  const sent = page.waitForRequest((request) => request.method() === "PATCH");
  await page
    .getByRole("button", { name: "변경 사항 저장", exact: true })
    .click();
  expect((await sent).postDataJSON()).toMatchObject({
    earliest_start: null,
    latest_end: null,
    estimated_minutes: 90,
    priority: 2,
    schedule_type: "flexible",
    description: null,
  });
  await expect(
    page.getByText("변경 사항을 저장했습니다.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "[테스트] 날짜 없는 일정 수정",
      exact: true,
    }),
  ).toBeVisible();
});

test("expired authentication on the dashboard schedule request clears the session", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  await page.route("**/test-api/api/tasks?**", (route) =>
    route.fulfill({ status: 401, json: { detail: "Unauthorized" } }),
  );
  await page.reload();
  await expect(page).toHaveURL(/\/login$/);
  expect(
    await page.evaluate(() => sessionStorage.getItem("plancatch.access_token")),
  ).toBeNull();
});
