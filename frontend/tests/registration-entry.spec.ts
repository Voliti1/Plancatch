import { test, expect } from "@playwright/test";
import { login, mockApi } from "./fixtures";
import { calendarTask } from "./calendar-fixtures";

test("schedule registration uses the shared fresh page and source library has no registration button", async ({
  page,
}) => {
  await mockApi(page, [], {
    tasks: [calendarTask],
    deadlines: [
      {
        id: "test-due",
        title: "지원 마감",
        due_at: "2026-11-09T09:00:00Z",
        source_id: null,
        description: null,
        deadline_type: null,
        evidence_text: null,
        confidence: null,
        is_confirmed: true,
        safe_due_at: null,
        safety_buffer_minutes: null,
        created_at: "2026-11-02T00:00:00Z",
        updated_at: "2026-11-02T00:00:00Z",
      },
    ],
  });
  await login(page);
  const menu = page.getByRole("navigation", { name: "주 메뉴" });
  await page.goto("/deadlines");
  const icons = page.locator(".schedule-rows .date-icon");
  await expect(icons).toHaveCount(2);
  expect(
    await icons.evaluateAll((items) =>
      items.map((el) => getComputedStyle(el).fontSize),
    ),
  ).toEqual(["35px", "35px"]);
  const size = await page.locator(".task-list-icon").evaluate((el) => ({
    width: el.getBoundingClientRect().width,
    height: el.getBoundingClientRect().height,
    box: el.parentElement!.getBoundingClientRect().width,
  }));
  expect(size).toEqual({ width: 35, height: 35, box: 40 });
  await expect(
    page.getByRole("group", { name: "등록할 일정 종류" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("마감 제목")).toHaveCount(0);
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && r.url().includes("/api/"))
      writes.push(r.method());
  });
  await page.getByRole("link", { name: "＋ 일정 등록", exact: true }).click();
  await expect(page).toHaveURL(/\/sources\/new\?new=.+/);
  await expect(
    page.getByRole("heading", { name: "새 일정 등록", exact: true }),
  ).toBeVisible();
  await expect(menu.locator("[aria-current]")).toHaveCount(0);
  await page.getByRole("tab", { name: "수동 일정 등록", exact: true }).click();
  await expect(menu.locator("[aria-current]")).toHaveCount(0);
  await page.getByLabel("일정명", { exact: true }).fill("남기지 않을 입력");
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "일정", exact: true })
    .click();
  await page.getByRole("link", { name: "＋ 일정 등록", exact: true }).click();
  await page.getByRole("tab", { name: "수동 일정 등록", exact: true }).click();
  await expect(page.getByLabel("일정명", { exact: true })).toHaveValue("");
  expect(writes).toEqual([]);
  await page.goto("/sources");
  await expect(
    menu.getByRole("link", { name: "원본 자료", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("link", { name: "＋ 자료 등록", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "자료 등록", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "새 일정 등록하기", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "삭제 모드", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page
    .getByRole("link", { name: "새 일정 등록하기", exact: true })
    .click();
  await expect(page).toHaveURL(/\/sources\/new\?new=.+/);
  await expect(menu.locator("[aria-current]")).toHaveCount(0);
  await page.goto("/sources/new?mode=manual");
  await expect(page.getByLabel("일정명", { exact: true })).toBeVisible();
  await expect(menu.locator("[aria-current]")).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("일정명", { exact: true })).toBeVisible();
  await expect(menu.locator("[aria-current]")).toHaveCount(0);
});
test("calendar view controls are today week month with the same gap", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  await page.goto("/calendar");
  const controls = page.getByRole("group", {
    name: "캘린더 보기 방식",
    exact: true,
  });
  await expect(controls.getByRole("button")).toHaveText([
    "오늘",
    "주간",
    "월간",
  ]);
  const boxes = await controls.getByRole("button").evaluateAll((items) =>
    items.map((el) => ({
      x: el.getBoundingClientRect().x,
      right: el.getBoundingClientRect().right,
      y: el.getBoundingClientRect().y,
    })),
  );
  expect(boxes[0].y).toBe(boxes[1].y);
  expect(boxes[1].y).toBe(boxes[2].y);
  expect(boxes[1].x - boxes[0].right).toBe(8);
  expect(boxes[2].x - boxes[1].right).toBe(8);
  await controls.getByRole("button", { name: "주간", exact: true }).click();
  await expect(page.getByRole("region", { name: "주간 시간표" })).toBeVisible();
  await controls.getByRole("button", { name: "오늘", exact: true }).click();
  await expect(page.getByRole("region", { name: "하루 시간표" })).toBeVisible();
  await controls.getByRole("button", { name: "월간", exact: true }).click();
  await expect(page.getByRole("group", { name: "월간 날짜" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
