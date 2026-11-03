import { test, expect } from "@playwright/test";
import { mockApi, login } from "./fixtures";
import { calendarTask } from "./calendar-fixtures";

for (const dark of [false, true])
  test(`schedule views in ${dark ? "dark" : "light"} mode stay responsive`, async ({
    page,
  }) => {
    await page.clock.install({ time: new Date("2026-11-02T03:00:00Z") });
    await mockApi(page, [], {
      tasks: [
        {
          ...calendarTask,
          title: "프로젝트 회의",
          earliest_start: "2026-11-02T01:00:00Z",
          latest_end: "2026-11-02T03:00:00Z",
        },
        {
          ...calendarTask,
          id: "overlap",
          title: "면접 준비",
          earliest_start: "2026-11-02T02:00:00Z",
          latest_end: "2026-11-02T04:00:00Z",
        },
      ],
    });
    await login(page);
    if (dark)
      await page.getByRole("button", { name: "다크 모드로 전환" }).click();
    await page.goto("/calendar?date=2026-11-02");
    await page.getByRole("button", { name: "주간", exact: true }).click();
    const grid = page.getByRole("region", { name: "주간 시간표" });
    await expect(grid.locator(".time-event")).toHaveCount(2);
    await grid.evaluate((el) => (el.scrollTop = 8 * 56));
    await page.screenshot({
      path: test.info().outputPath("week.png"),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.getByRole("button", { name: "오늘", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "하루 시간표" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "다음 기간" }).click();
    await expect(
      page
        .getByRole("region", { name: "일정 캘린더", exact: true })
        .getByRole("heading", { name: "2026년 11월 3일 화요일" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "이전 기간" }).click();
    await expect(
      page.getByRole("region", { name: "하루 시간표" }).locator(".time-event"),
    ).toHaveCount(2);
    await page.goto("/deadlines");
    await expect(page.locator(".schedule-rows > *")).toHaveCount(2);
    expect(
      await page
        .locator(".schedule-rows .schedule-kind-task")
        .first()
        .evaluate((el) => [
          getComputedStyle(el).backgroundColor,
          getComputedStyle(el).color,
        ]),
    ).toEqual(["rgb(48, 94, 232)", "rgb(255, 255, 255)"]);
    await page
      .getByRole("group", { name: "표시할 일정 종류" })
      .getByLabel("마감일", { exact: true })
      .uncheck();
    await page.screenshot({
      path: test.info().outputPath("list.png"),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  });
