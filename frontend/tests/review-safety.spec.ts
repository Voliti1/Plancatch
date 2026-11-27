import { test, expect } from "@playwright/test";
import { login } from "./fixtures";
import { aiSource, mockAnalyses, readyAnalysis } from "./analysis-fixtures";

for (const [kind, model] of [
  ["url", "html:url:v1"],
  ["text", "test-only-synthetic"],
  ["pdf", "pdf:text:v1"],
  ["image", "image:test-only"],
] as const) {
  test(`${kind} review saves each safety buffer, restores it on reload, and applies it on direct approval`, async ({
    page,
  }) => {
    const state = await mockAnalyses(page, [{ ...readyAnalysis, model }], {
      ...aiSource,
      source_type: kind,
    });
    await login(page);
    await page.goto("/analyses/analysis-1");
    const first = page.locator(".analysis-candidate").nth(0);
    const second = page.locator(".analysis-candidate").nth(1);
    await expect(
      first.getByLabel("안전 마감일 사용", { exact: true }),
    ).not.toBeChecked();
    const label = first.locator(".safety-toggle");
    await expect(label).toHaveCSS("font-weight", "700");
    await expect(label).toHaveCSS("font-size", "16px");
    await first.getByLabel("안전 마감일 사용", { exact: true }).check();
    await first.getByLabel("여유시간 (일)", { exact: true }).fill("1");
    await first.getByLabel("여유시간 (시간)", { exact: true }).fill("3");
    await first.getByLabel("여유시간 (분)", { exact: true }).fill("20");
    await second.getByLabel("등록할 일정에 포함 2", { exact: true }).check();
    await second
      .locator('input[type="datetime-local"]')
      .fill("2026-12-10T18:00");
    await second.getByLabel("안전 마감일 사용", { exact: true }).check();
    await second.getByLabel("여유시간 (분)", { exact: true }).fill("60");
    await page
      .getByRole("button", { name: "검토 내용 저장", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("검토 내용을 저장");
    expect(
      state.analyses[0].candidates.map((c) => c.safety_buffer_minutes),
    ).toEqual([1640, 60]);
    await page.reload();
    await expect(
      first.getByLabel("안전 마감일 사용", { exact: true }),
    ).toBeChecked();
    await expect(
      first.getByLabel("여유시간 (일)", { exact: true }),
    ).toHaveValue("1");
    await second.getByLabel("안전 마감일 사용", { exact: true }).uncheck();
    await page.getByRole("button", { name: /선택한 2개 일정 등록/ }).click();
    await expect(
      page.getByRole("heading", { name: "마감일 등록 완료", exact: true }),
    ).toBeVisible();
    expect(state.deadlines.map((d) => d.safety_buffer_minutes)).toEqual([
      1640,
      null,
    ]);
    expect(state.deadlines[0].safe_due_at).toBe("2026-09-29T20:40:45.123Z");
    expect(state.deadlines[1].safe_due_at).toBeNull();
  });
}

test("review safety validation prevents writes and keeps edits through a failed save", async ({
  page,
}) => {
  const state = await mockAnalyses(page);
  await login(page);
  await page.goto("/analyses/analysis-1");
  const first = page.locator(".analysis-candidate").nth(0);
  await first.getByLabel("안전 마감일 사용", { exact: true }).check();
  const minutes = first.getByLabel("여유시간 (분)", { exact: true });
  for (const value of ["", "0", "-1", "1.5", "2147483648"]) {
    await minutes.fill(value);
    await page.getByRole("button", { name: /선택한 1개 일정 등록/ }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "여유시간",
    );
    expect(state.analyses[0].revision).toBe(1);
    expect(state.deadlines).toHaveLength(0);
  }
  await minutes.fill("60");
  await page.route("**/test-api/api/ai-analyses/analysis-1", (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({ status: 503, json: { detail: "[테스트] 저장 실패" } })
      : route.fallback(),
  );
  await page.getByRole("button", { name: /선택한 1개 일정 등록/ }).click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(minutes).toHaveValue("60");
  expect(state.deadlines).toHaveLength(0);
  await page.unroute("**/test-api/api/ai-analyses/analysis-1");
  await page.getByRole("button", { name: /선택한 1개 일정 등록/ }).click();
  await expect(
    page.getByRole("heading", { name: "마감일 등록 완료", exact: true }),
  ).toBeVisible();
  expect(state.deadlines[0].safety_buffer_minutes).toBe(60);
});

