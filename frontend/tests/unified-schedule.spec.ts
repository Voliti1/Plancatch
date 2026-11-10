import { test, expect } from "@playwright/test";
import { mockApi, login } from "./fixtures";
import { calendarTask } from "./calendar-fixtures";

const deadline = {
  id: "same-id",
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
  safety_buffer_minutes: null,
  safe_due_at: null,
};
const task = {
  ...calendarTask,
  id: "same-id",
  title: "지원 회의",
  earliest_start: "2026-11-02T06:00:00Z",
  latest_end: "2026-11-02T07:00:00Z",
};

test("deleted Google copies keep their status after reload and retry without deleting locally twice", async ({
  page,
}) => {
  await mockApi(page, [], { tasks: [task] });
  await login(page);
  await page.clock.install();
  let locallyDeleted = false;
  let state: "pending" | "failed" | "deleted" = "pending";
  let retryPosts = 0;
  let localDeletes = 0;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/test-api/api/tasks/same-id", async (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    locallyDeleted = true;
    localDeletes++;
    return route.fallback();
  });
  await page.route(
    "**/test-api/api/integrations/google-calendar/auto-sync/deletions?**",
    (route) =>
      route.fulfill({
        json: {
          entries: locallyDeleted
            ? [
                {
                  kind: "task",
                  item_id: task.id,
                  title: task.title,
                  state,
                  note:
                    state === "failed"
                      ? "연결을 확인한 뒤 다시 시도해 주세요."
                      : "Google 삭제 상태",
                  retryable: state === "failed",
                },
              ]
            : [],
          has_more: false,
        },
      }),
  );
  await page.route(
    "**/test-api/api/integrations/google-calendar/auto-sync",
    async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      retryPosts++;
      expect(route.request().postDataJSON()).toEqual({
        kind: "task",
        item_id: task.id,
      });
      await waiting;
      state = "pending";
      return route.fulfill({ status: 202, json: { state: "pending" } });
    },
  );
  await page.goto("/deadlines");
  await page.getByRole("button", { name: "삭제 모드", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "지원 회의 선택", exact: true })
    .click();
  await page.getByRole("button", { name: "삭제", exact: true }).click();
  await page.getByRole("button", { name: "삭제 확인", exact: true }).click();
  const panel = page.getByRole("region", {
    name: "Google 캘린더 삭제 상태",
    exact: true,
  });
  await expect(panel).toContainText("삭제 중");
  await expect(page.locator(".schedule-rows")).toHaveCount(0);
  state = "failed";
  await page.reload();
  await expect(panel).toContainText("삭제 확인 필요");
  await expect(panel).toContainText("연결을 확인한 뒤");
  await panel.screenshot({
    path: test.info().outputPath("google-delete-failed.png"),
  });
  const retry = panel.getByRole("button", {
    name: "지원 회의 Google 삭제 다시 시도",
    exact: true,
  });
  await retry.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(retry).toBeDisabled();
  expect(retryPosts).toBe(1);
  release();
  await expect(panel).toContainText("삭제 중");
  state = "deleted";
  await page.clock.fastForward(2600);
  await expect(panel).toContainText("삭제 완료");
  expect(localDeletes).toBe(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("unified title search, native type chips, distinct deletion keys and task details", async ({
  page,
}) => {
  await mockApi(page, [], { deadlines: [deadline], tasks: [task] });
  await login(page);
  await page.goto("/deadlines");
  await expect(
    page.getByRole("heading", { name: "일정", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation")
      .getByRole("link", { name: "일정", exact: true }),
  ).toBeVisible();
  const filters = page.getByRole("group", { name: "표시할 일정 종류" }),
    rows = page.locator(".schedule-rows > *");
  await expect(rows).toHaveCount(2);
  await expect(rows.locator("svg.task-list-icon")).toHaveCount(1);
  await expect(rows.locator("svg.task-list-icon rect")).toHaveCount(1);
  await expect(filters.getByLabel("할 일", { exact: true })).toBeChecked();
  expect(
    await filters
      .locator("label")
      .first()
      .evaluate((el) => [
        getComputedStyle(el).backgroundColor,
        getComputedStyle(el).color,
      ]),
  ).toEqual(["rgb(48, 94, 232)", "rgb(255, 255, 255)"]);
  await filters.getByLabel("마감일", { exact: true }).uncheck();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("지원 회의");
  await filters.getByLabel("할 일", { exact: true }).uncheck();
  await expect(rows).toHaveCount(0);
  await filters.getByLabel("마감일", { exact: true }).check();
  await filters.getByLabel("할 일", { exact: true }).check();
  await page.getByRole("searchbox", { name: "일정 제목 검색" }).fill("회의");
  await expect(rows).toHaveCount(1);
  await expect(rows.locator("mark")).toHaveText("회의");
  await page.getByRole("searchbox", { name: "일정 제목 검색" }).fill("");
  await expect(rows).toHaveCount(2);
  await page.getByRole("button", { name: "삭제 모드", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "지원 회의 선택", exact: true })
    .click();
  await page.getByRole("button", { name: "삭제", exact: true }).click();
  const deleted = page.waitForRequest((r) => r.method() === "DELETE");
  await page.getByRole("button", { name: "삭제 확인", exact: true }).click();
  expect((await deleted).url()).toContain("/api/tasks/same-id");
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("지원 마감");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
