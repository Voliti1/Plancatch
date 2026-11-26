import { expect, test, type Page } from "@playwright/test";
import { login, mockApi } from "./fixtures";

const row = (id: string, title: string, sort_at: string | null) => ({
  id,
  title,
  sort_at,
  completion_due_at: sort_at,
  deadline_id: null,
  description: null,
  estimated_minutes: 60,
  priority: 3,
  schedule_type: "flexible",
  earliest_start: null,
  latest_end: null,
  is_completed: false,
  completed_at: null,
  created_at: "2026-11-10T00:00:00Z",
  updated_at: "2026-11-10T00:00:00Z",
});
const rows = [
  row("none", "날짜 없는 일", null),
  row("late", "다음 날짜", "2026-11-12T00:00:00Z"),
  row("na", "나 준비", "2026-11-11T05:00:00Z"),
  row("ga", "가 준비", "2026-11-11T05:00:00Z"),
  row("early", "오전 준비", "2026-11-11T00:00:00Z"),
];
test("retrying a failed title search never submits a selected planning task", async ({
  page,
}) => {
  await setup(page);
  const search = page.getByRole("searchbox", { name: "할 일 제목 검색" });
  const panel = page.getByRole("region", { name: "시간을 정할 할 일 목록" });
  await panel.getByRole("checkbox", { name: /가 준비/ }).check();
  let failed = false;
  let writes = 0;
  page.on("request", (r) => {
    if (r.method() !== "GET") writes++;
  });
  await page.route("**/test-api/api/scheduling/tasks?*", (r) => {
    if (!failed) {
      failed = true;
      return r.fulfill({ status: 503, json: { detail: "일시적인 조회 오류" } });
    }
    return r.fulfill({ json: { entries: [rows[3]], has_more: false } });
  });
  await search.fill("가");
  await expect(panel.getByRole("alert")).toBeVisible();
  await panel.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect(panel.getByRole("checkbox", { name: /가 준비/ })).toBeChecked();
  expect(writes).toBe(0);
});
async function setup(page: Page) {
  await mockApi(page);
  await login(page);
  await page.route("**/test-api/api/scheduling/tasks?*", (r) => {
    const q = new URL(r.request().url()).searchParams.get("q") ?? "";
    return r.fulfill({
      json: {
        entries: rows.filter((t) => t.title.includes(q)),
        has_more: false,
        next_offset: null,
      },
    });
  });
  await page.goto("/planning");
}
test("searchable task list groups Seoul dates and orders time then Korean titles, retaining selection", async ({
  page,
}) => {
  await setup(page);
  const search = page.getByRole("searchbox", { name: "할 일 제목 검색" });
  const panel = page.getByRole("region", { name: "시간을 정할 할 일 목록" });
  await expect(panel.locator("h3")).toHaveText([
    /2026년 11월 11일/,
    /2026년 11월 12일/,
    "날짜 미정",
  ]);
  await expect(panel.locator(".checkbox-row > span")).toHaveText([
    /오전 준비.*60분.*오전 9:00/,
    /가 준비.*60분.*오후 2:00/,
    /나 준비.*60분.*오후 2:00/,
    /다음 날짜.*60분.*오전 9:00/,
    /날짜 없는 일.*마감일 없음/,
  ]);
  await panel.getByRole("checkbox", { name: /가 준비/ }).check();
  await search.fill("오전");
  await expect(panel.getByRole("checkbox")).toHaveCount(1);
  await panel.getByRole("checkbox", { name: /오전 준비/ }).check();
  await expect(
    page.getByRole("heading", { name: "선택한 할 일 2개" }),
  ).toBeVisible();
  await search.fill("");
  await expect(panel.getByRole("checkbox", { name: /가 준비/ })).toBeChecked();
  await expect(
    panel.getByRole("checkbox", { name: /오전 준비/ }),
  ).toBeChecked();
  await page.getByRole("button", { name: "모두 해제", exact: true }).click();
  await expect(page.getByRole("heading", { name: /선택한 할 일/ })).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("task list can browse later pages, search with no matches, and retry failures", async ({
  page,
}) => {
  await setup(page);
  let fail = true;
  await page.route("**/test-api/api/scheduling/tasks?*", (r) => {
    const p = new URL(r.request().url()).searchParams;
    if (p.get("q") === "없음")
      return r.fulfill({ json: { entries: [], has_more: false } });
    if (p.get("offset") === "100") {
      if (fail) {
        fail = false;
        return r.fulfill({
          status: 503,
          json: { detail: "잠시 후 다시 시도해 주세요" },
        });
      }
      return r.fulfill({ json: { entries: [rows[0]], has_more: false } });
    }
    return r.fulfill({
      json: { entries: [rows[1]], has_more: true, next_offset: 100 },
    });
  });
  await page.reload();
  const search = page.getByRole("searchbox", { name: "할 일 제목 검색" });
  await search.fill("없음");
  const panel = page.getByRole("region", { name: "시간을 정할 할 일 목록" });
  await expect(panel).toContainText("검색 결과가 없어요");
  await search.fill("");
  await panel.getByRole("button", { name: "할 일 더 보기" }).click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await panel.getByRole("button", { name: "할 일 더 보기" }).click();
  await expect(panel.getByRole("checkbox")).toHaveCount(2);
  await expect(
    panel.getByRole("button", { name: "할 일 더 보기" }),
  ).toHaveCount(0);
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await panel.screenshot({
    path: test.info().outputPath("task-task list-dark.png"),
  });
  expect(
    await panel.evaluate((el) => el.scrollHeight > 0 && el.clientHeight <= 400),
  ).toBe(true);
});
