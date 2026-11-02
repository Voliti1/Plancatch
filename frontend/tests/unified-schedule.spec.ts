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
