import { test, expect } from "@playwright/test";
import { login } from "./fixtures";
import { mockAnalyses, readyAnalysis } from "./analysis-fixtures";

test("application period and source summary share a desktop row, stack on mobile, with candidates below", async ({
  page,
}) => {
  await mockAnalyses(page, [
    {
      ...readyAnalysis,
      source_period: {
        start_text: "2026.10.01 00:00",
        end_text: "2026.11.03 23:59",
        deadline_at: "2026-11-03T14:59:00Z",
        remaining_text: "14일 12:00:00",
        has_conflict: false,
      },
    },
  ]);
  await login(page);
  await page.goto("/analyses/analysis-1");
  const period = page.getByRole("region", {
    name: "사람인 접수기간",
    exact: true,
  });
  const summary = page.getByRole("region", {
    name: "자료 정보 요약",
    exact: true,
  });
  await expect(period).toBeVisible();
  await expect(summary).toBeVisible();
  const p = (await period.boundingBox())!;
  const s = (await summary.boundingBox())!;
  const c = (await page.locator(".analysis-review").boundingBox())!;
  if (page.viewportSize()!.width > 1000) {
    expect(Math.abs(p.y - s.y)).toBeLessThan(2);
    expect(s.x).toBeGreaterThanOrEqual(p.x + p.width);
    expect(Math.abs(p.height - s.height)).toBeLessThan(2);
  } else {
    expect(s.y).toBeGreaterThanOrEqual(p.y + p.height);
  }
  expect(c.y).toBeGreaterThanOrEqual(Math.max(p.y + p.height, s.y + s.height));
  expect(c.width).toBeGreaterThanOrEqual(Math.max(p.width, s.width));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: test.info().outputPath("review-overview-row.png"),
    fullPage: true,
  });
});

test("without application period the source summary uses the full row without an empty column", async ({
  page,
}) => {
  await mockAnalyses(page, [{ ...readyAnalysis, source_period: null }]);
  await login(page);
  await page.goto("/analyses/analysis-1");
  await expect(
    page.getByRole("region", { name: "사람인 접수기간", exact: true }),
  ).toHaveCount(0);
  const summary = page.getByRole("region", {
    name: "자료 정보 요약",
    exact: true,
  });
  await expect(summary).toBeVisible();
  const s = (await summary.boundingBox())!;
  const c = (await page.locator(".analysis-review").boundingBox())!;
  expect(Math.abs(s.x - c.x)).toBeLessThan(2);
  expect(Math.abs(s.width - c.width)).toBeLessThan(2);
  expect(c.y).toBeGreaterThanOrEqual(s.y + s.height);
});
