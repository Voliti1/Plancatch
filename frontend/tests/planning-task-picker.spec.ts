import { expect, test, type Page } from "@playwright/test";
import { login, mockApi } from "./fixtures";

const row = (id: string, title: string, sort_at: string | null) => ({
  id,
  title,
  sort_at,
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
test("searchable dropdown groups Seoul dates and orders time then Korean titles, retaining selection", async ({
  page,
}) => {
  await setup(page);
  const search = page.getByRole("combobox", { name: "할 일 제목 검색" });
  await expect(
    page.getByRole("dialog", { name: "배치할 할 일 선택" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "할 일 목록 열기" }).click();
  const panel = page.getByRole("dialog", { name: "배치할 할 일 선택" });
  await expect(panel.locator("h3")).toHaveText([
    "2026년 11월 11일",
    "2026년 11월 12일",
    "날짜 미정",
  ]);
  await expect(panel.locator(".checkbox-row > span")).toHaveText([
    /오전 준비09:00/,
    /가 준비14:00/,
    /나 준비14:00/,
    /다음 날짜09:00/,
    /날짜 없는 일시간 미정/,
  ]);
  await panel.getByRole("checkbox", { name: /가 준비/ }).check();
  await search.fill("오전");
  await expect(panel.getByRole("checkbox")).toHaveCount(1);
  await panel.getByRole("checkbox", { name: /오전 준비/ }).check();
  await expect(page.locator(".planning-picker > p")).toContainText("2개 선택");
  await search.fill("");
  await expect(panel.getByRole("checkbox", { name: /가 준비/ })).toBeChecked();
  await expect(
    panel.getByRole("checkbox", { name: /오전 준비/ }),
  ).toBeChecked();
  await panel.getByRole("checkbox", { name: /나 준비/ }).focus();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(search).toBeFocused();
  await expect(search).toHaveAttribute("aria-expanded", "false");
  await search.click();
  await expect(panel).toBeVisible();
  await page.getByRole("heading", { name: "자동 배치", exact: true }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole("button", { name: "선택 해제", exact: true }).click();
  await expect(page.locator(".planning-picker > p")).toContainText("0개 선택");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("dropdown can browse later pages, search with no matches, and retry failures", async ({
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
  const search = page.getByRole("combobox", { name: "할 일 제목 검색" });
  await search.fill("없음");
  const panel = page.getByRole("dialog", { name: "배치할 할 일 선택" });
  await expect(panel).toContainText("검색 결과가 없습니다");
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
    path: test.info().outputPath("task-dropdown-dark.png"),
  });
  expect(
    await panel.evaluate((el) => el.scrollHeight > 0 && el.clientHeight <= 400),
  ).toBe(true);
});
