import { test, expect } from "@playwright/test";
import { login, mockApi } from "./fixtures";
import { calendarTask } from "./calendar-fixtures";

test("larger typography aligns detail cards and keeps calendar and compact registration usable", async ({
  page,
}) => {
  await mockApi(page, [], { tasks: [calendarTask] });
  await login(page);
  await page.goto(`/tasks/${calendarTask.id}`);
  const cards = page.locator(
    ".task-detail, [aria-label='Google 자동 동기화'], .schedule-detail-danger",
  );
  await expect(cards).toHaveCount(3);
  const boxes = await cards.evaluateAll((items) =>
    items.map((item) => ({
      x: item.getBoundingClientRect().x,
      width: item.getBoundingClientRect().width,
    })),
  );
  for (const box of boxes) {
    expect(Math.abs(box.x - boxes[0].x)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.width - boxes[0].width)).toBeLessThanOrEqual(1);
  }
  await expect(page.locator("body")).toHaveCSS(
    "font-size",
    page.viewportSize()!.width > 760 ? "17px" : "16px",
  );
  await expect(
    page.getByRole("region", { name: "캘린더 배치", exact: true }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/calendar?date=2026-11-02");
  await expect(page.getByRole("region", { name: "하루 시간표" })).toBeVisible();
  const controls = page.getByRole("group", {
    name: "캘린더 보기 방식",
    exact: true,
  });
  const controlsBox = (await controls.boundingBox())!;
  expect(controlsBox.x + controlsBox.width).toBeLessThanOrEqual(320);
  await page.getByRole("button", { name: "월간", exact: true }).click();
  const cell = page.locator(".calendar-day").first();
  await expect(cell).toBeVisible();
  expect((await cell.boundingBox())!.height).toBeGreaterThanOrEqual(112);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.goto("/sources/new?mode=manual");
  const sentence = page.getByLabel("일정 설명 (선택)", { exact: true });
  await expect(sentence).toBeVisible();
  expect((await sentence.boundingBox())!.height).toBeLessThanOrEqual(90);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("readability-manual-320.png"),
    fullPage: true,
  });
});
