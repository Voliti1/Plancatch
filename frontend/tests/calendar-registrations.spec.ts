import { test, expect } from "@playwright/test";
import { login, mockApi } from "./fixtures";
import { calendarApi, calendarEvent } from "./calendar-fixtures";
import type { Deadline } from "../types/api";

const deadline: Deadline = {
  id: "source-deadline",
  source_id: "source-1",
  title: "자료에서 등록한 지원 마감",
  due_at: "2026-11-06T14:59:00Z",
  safety_buffer_minutes: null,
  safe_due_at: null,
  deadline_type: null,
  description: null,
  confidence: 1,
  evidence_text: "마감일 11월 6일",
  is_confirmed: true,
  created_at: "2026-10-20T00:00:00Z",
  updated_at: "2026-10-20T00:00:00Z",
};

test("existing manual registration appears immediately as a white-title colour bar without another placement", async ({
  page,
}) => {
  await mockApi(page, [], { deadlines: [deadline] });
  await login(page);
  await page
    .getByRole("link", { name: "새 일정 등록하기", exact: true })
    .click();
  await page.getByRole("tab", { name: "수동 일정 등록", exact: true }).click();
  await page.getByLabel("일정명", { exact: true }).fill("팀 프로젝트 회의");
  await page.getByLabel("시작 일시", { exact: true }).fill("2026-11-06T09:00");
  await page.getByLabel("종료 일시", { exact: true }).fill("2026-11-06T10:00");
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && r.url().includes("/api/"))
      writes.push(new URL(r.url()).pathname);
  });
  await page.getByRole("button", { name: "일정 등록", exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\/task-1$/);
  await page.goto("/calendar?date=2026-11-06");
  const cell = page.getByRole("button", {
    name: "2026년 11월 6일 금요일",
    exact: true,
  });
  await expect(cell.locator(".calendar-event-bar")).toHaveCount(2);
  await expect(cell.getByText("팀 프로젝트 회의", { exact: true })).toHaveCSS(
    "color",
    "rgb(255, 255, 255)",
  );
  await expect(cell.locator(".bar-fixed_task")).toHaveCSS(
    "background-color",
    "rgb(48, 94, 232)",
  );
  await expect(cell.locator(".bar-deadline")).toContainText(deadline.title);
  await expect(cell.locator(".bar-deadline")).toHaveCSS(
    "color",
    "rgb(255, 255, 255)",
  );
  expect(writes).toEqual(["/test-api/api/tasks"]);
  await expect(
    page.getByRole("button", { name: "＋ 일정 등록", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "팀 프로젝트 회의", exact: true }),
  ).toHaveAttribute("href", "/tasks/task-1");
  await expect(
    page.getByRole("link", { name: deadline.title, exact: true }),
  ).toHaveAttribute("href", "/deadlines/source-deadline");
  await expect(
    page.getByText("선택한 날짜에 배치된 일정이 없습니다", { exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(cell.locator(".calendar-event-bar")).toHaveCount(2);
  await page.screenshot({
    path: test.info().outputPath("registered-calendar-bars.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("missing registration API is reported and not disguised as an empty calendar", async ({
  page,
}) => {
  await mockApi(page);
  await page.route("**/calendar/registrations?**", (route) =>
    route.fulfill({ status: 503, json: { detail: "잠시 후 재시도" } }),
  );
  await login(page);
  await page.goto("/calendar?date=2026-11-06");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "등록한 마감일·수동 일정을 불러오지 못했습니다",
  );
  await expect(
    page.getByText("선택한 날짜에 배치된 일정이 없습니다", { exact: true }),
  ).toHaveCount(0);
  await page.unroute("**/calendar/registrations?**");
  await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect(
    page.getByText("선택한 날짜에 배치된 일정이 없습니다", { exact: true }),
  ).toBeVisible();
});

test("registration errors keep separate local placements visible", async ({
  page,
}) => {
  await calendarApi(page, [calendarEvent]);
  await page.route("**/calendar/registrations?**", (route) =>
    route.fulfill({ status: 503, json: { detail: "[테스트] 등록 일정 오류" } }),
  );
  await login(page);
  await page.goto("/calendar?date=2026-11-01");
  await expect(page.locator(".calendar-agenda")).toContainText(
    "[테스트] 캘린더 회의",
  );
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "등록한 마감일·수동 일정을 불러오지 못했습니다",
  );
});

test("busy days cap bars, retain totals and preserve all registered entries in the agenda", async ({
  page,
}) => {
  await mockApi(page, [], {
    deadlines: Array.from({ length: 22 }, (_, i) => ({
      ...deadline,
      id: `deadline-${i}`,
      title: `자료 마감 ${i}`,
    })),
  });
  await login(page);
  await page.goto("/calendar?date=2026-11-06");
  const cell = page.getByRole("button", {
    name: "2026년 11월 6일 금요일",
    exact: true,
  });
  await expect(cell).toContainText("22");
  await expect(cell.locator(".calendar-event-bar")).toHaveCount(3);
  await expect(cell.getByText("+19개 더 보기", { exact: true })).toBeVisible();
  await expect(page.locator(".registered-day-events li")).toHaveCount(20);
  await page.getByRole("button", { name: "다음 등록 일정" }).click();
  await expect(page.locator(".registered-day-events li")).toHaveCount(2);
  await page.getByRole("button", { name: "주간", exact: true }).click();
  await expect(
    page
      .getByRole("group", { name: "주간 날짜" })
      .locator(".calendar-event-bar"),
  ).toHaveCount(3);
});
