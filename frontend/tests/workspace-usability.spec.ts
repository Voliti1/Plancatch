import { test, expect } from "@playwright/test";
import { login, mockApi } from "./fixtures";
import { calendarTask } from "./calendar-fixtures";
import type { Availability } from "../features/calendar/availability-page";

test("calendar starts monthly and remembers view and Google visibility across navigation and reload", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/calendar?date=2026-12-02");
  await expect(
    page.getByRole("button", { name: "월간", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "주간", exact: true }).click();
  await page.getByLabel("구글 일정 함께 보기").check();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "주간", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("구글 일정 함께 보기")).toBeChecked();
  await page.goto("/dashboard");
  await page.goto("/calendar");
  await expect(
    page.getByRole("button", { name: "주간", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "오늘", exact: true }).click();
  await page.getByLabel("구글 일정 함께 보기").uncheck();
  await page.reload();
  await expect(page.getByRole("region", { name: "하루 시간표" })).toBeVisible();
  await expect(page.getByLabel("구글 일정 함께 보기")).not.toBeChecked();
  await page.evaluate(() => {
    localStorage.setItem("plancatch.calendar.view", "bad-view");
    localStorage.setItem("plancatch.calendar.showGoogle", "not-a-boolean");
  });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "월간", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("구글 일정 함께 보기")).not.toBeChecked();
  expect(errors).toEqual([]);
});

test("invalid or unavailable calendar storage falls back to a working month view", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      value: {
        getItem() {
          throw new Error("storage blocked");
        },
        setItem() {
          throw new Error("storage blocked");
        },
      },
    });
  });
  await mockApi(page);
  await login(page);
  await page.goto("/calendar");
  await expect(
    page.getByRole("button", { name: "월간", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "주간", exact: true }).click();
  await expect(page.getByRole("region", { name: "주간 시간표" })).toBeVisible();
});

test("incomplete filter finds matching tasks after completed source pages and keeps deadlines", async ({
  page,
}) => {
  await mockApi(page, [], {
    deadlines: [
      {
        id: "kept-deadline",
        title: "유지할 마감일",
        due_at: "2026-12-10T09:00:00Z",
        source_id: null,
        deadline_type: null,
        description: null,
        is_confirmed: true,
        safety_buffer_minutes: null,
        safe_due_at: null,
        confidence: null,
        evidence_text: null,
        created_at: "2026-11-01T00:00:00Z",
        updated_at: "2026-11-01T00:00:00Z",
      },
    ],
    tasks: [
      ...Array.from({ length: 55 }, (_, i) => ({
        ...calendarTask,
        id: `a-${String(i).padStart(2, "0")}`,
        title: `완료 작업 ${i}`,
        is_completed: true,
      })),
      {
        ...calendarTask,
        id: "z-open",
        title: "시간 미정 작업",
        is_completed: false,
        schedule_type: "flexible",
        earliest_start: null,
        latest_end: null,
        recurrence: { frequency: "weekly", interval: 1, count: 3 },
      },
    ],
  });
  await login(page);
  await page.goto("/deadlines");
  await page.getByLabel("완료된 항목 숨기기").check();
  const rows = page.locator(".schedule-rows");
  await expect(rows).toContainText("시간 미정 작업");
  await expect(rows).toContainText("시간 미정");
  await expect(rows).toContainText("시간 추천 가능");
  await expect(rows).toContainText("유지할 마감일");
  await expect(rows).not.toContainText("완료 작업");
  await expect(rows).not.toContainText("삭제 시 전체 반복 삭제");
  await page.getByRole("button", { name: "삭제 모드", exact: true }).click();
  await expect(rows).toContainText("삭제 시 전체 반복 삭제");
  await page.getByLabel("완료된 항목 숨기기").uncheck();
  await expect(rows).toContainText("완료 작업");
});

for (const theme of ["light", "dark"] as const) {
  test(`weekly presets copy independent intervals and sticky save clears only on success in ${theme}`, async ({
    page,
  }) => {
    await mockApi(page);
    let saved: Availability = {
      revision: 0,
      timezone: "Asia/Seoul",
      weekly: Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        intervals: [],
      })),
      exceptions: [],
    };
    let fail = false;
    await page.route("**/api/scheduling/availability", (route) => {
      if (route.request().method() === "PUT") {
        if (fail)
          return route.fulfill({
            status: 503,
            json: { detail: "저장 실패 테스트" },
          });
        saved = {
          ...route.request().postDataJSON(),
          revision: saved.revision + 1,
        };
      }
      return route.fulfill({ json: saved });
    });
    await login(page);
    await page.goto("/planning/availability");
    await page
      .locator("html")
      .evaluate((e, t) => e.setAttribute("data-theme", t), theme);
    const bar = page.getByRole("region", { name: "가능 시간 변경 저장" });
    await expect(bar).toHaveCount(0);
    await page
      .getByRole("button", { name: "매일 09:00~18:00", exact: true })
      .click();
    await expect(page.getByLabel("일요일 1 시작", { exact: true })).toHaveValue(
      "09:00",
    );
    await page.getByLabel("월요일 1 시작", { exact: true }).fill("10:00");
    await page
      .getByRole("button", {
        name: "월요일 시간을 평일 전체에 복사",
        exact: true,
      })
      .click();
    await expect(page.getByLabel("금요일 1 시작", { exact: true })).toHaveValue(
      "10:00",
    );
    await page.getByLabel("화요일 1 시작", { exact: true }).fill("11:00");
    await expect(page.getByLabel("월요일 1 시작", { exact: true })).toHaveValue(
      "10:00",
    );
    await page
      .getByRole("button", { name: "주말 쉬는 날로 설정", exact: true })
      .click();
    await expect(page.getByLabel("토요일 1 시작", { exact: true })).toHaveCount(
      0,
    );
    await page
      .getByRole("button", { name: "평일 09:00~18:00", exact: true })
      .click();
    await expect(page.getByLabel("금요일 1 시작", { exact: true })).toHaveValue(
      "09:00",
    );
    await expect(bar).toHaveCSS("position", "sticky");
    await page
      .getByLabel("목요일 1 종료", { exact: true })
      .scrollIntoViewIfNeeded();
    const box = await bar.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(
      page.viewportSize()!.height + 1,
    );
    await page.screenshot({
      path: test.info().outputPath(`availability-sticky-${theme}.png`),
    });
    fail = true;
    await bar
      .getByRole("button", { name: "가능 시간 저장", exact: true })
      .click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "저장 실패 테스트",
    );
    await expect(bar).toBeVisible();
    fail = false;
    await bar
      .getByRole("button", { name: "가능 시간 저장", exact: true })
      .click();
    await expect(bar).toHaveCount(0);
    expect(
      saved.weekly
        .slice(5)
        .every((day) => day.rest_day && !day.intervals.length),
    ).toBe(true);
    await page.reload();
    await expect(page.getByLabel("금요일 1 종료", { exact: true })).toHaveValue(
      "18:00",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

test("recommendation empty state offers registration and four wrapping condition chips", async ({
  page,
}) => {
  await mockApi(page);
  await page.route("**/api/scheduling/tasks?**", (route) =>
    route.fulfill({ json: { entries: [], has_more: false } }),
  );
  await login(page);
  await page.goto("/planning");
  await expect(
    page.getByText(
      "추천받을 할 일이 없나요? 시간이 정해지지 않은 할 일로 등록하고 예상 소요시간을 입력해 주세요.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "새 할 일 만들기", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("recommendation-chips.png"),
    fullPage: true,
  });
  const chips = page.locator(".planning-conditions-values > span");
  await expect(chips).toHaveCount(4);
  await expect(chips.first()).toHaveCSS("border-radius", "999px");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
