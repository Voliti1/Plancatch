import { expect, test } from "@playwright/test";
import { login, mockApi } from "./fixtures";
import type { Task } from "../types/task";

const parent: Task = {
  id: "series",
  deadline_id: null,
  title: "주간 회의",
  description: "준비물",
  estimated_minutes: 60,
  priority: 3,
  schedule_type: "fixed",
  earliest_start: "2026-11-02T06:00:00Z",
  latest_end: "2026-11-02T07:00:00Z",
  recurrence: { frequency: "weekly", interval: 1, count: 3 },
  google_reminders: { mode: "none", overrides: [] },
  is_completed: false,
  completed_at: null,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
};
const at = "2026-11-09T06:00:00Z";
const effective: Task = {
  ...parent,
  series_id: parent.id,
  original_start: at,
  recurrence: null,
  earliest_start: at,
  latest_end: "2026-11-09T07:00:00Z",
};
const href = `/tasks/series?${new URLSearchParams({ occurrence: at })}`;

test("repeat ending can use this month or a chosen inclusive date", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-11-10T03:00:00Z"));
  await mockApi(page);
  await login(page);
  await page.goto("/sources/new?mode=manual");
  await page
    .getByRole("textbox", { name: "일정명", exact: true })
    .fill("이번 달 운동");
  await page.getByLabel("시작 일시", { exact: true }).fill("2026-11-16T15:00");
  await page.getByLabel("반복 주기", { exact: true }).selectOption("daily");
  await page.getByLabel("반복 종료", { exact: true }).selectOption("month");
  await expect(page.getByLabel("반복 종료일", { exact: true })).toHaveValue(
    "2026-11-30",
  );
  await page.getByLabel("반복 종료일", { exact: true }).fill("2026-11-25");
  const sent = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/api/tasks"),
  );
  await page.getByRole("button", { name: "일정 등록", exact: true }).click();
  expect((await sent).postDataJSON().recurrence).toMatchObject({
    frequency: "daily",
    until: "2026-11-25",
    count: null,
  });
});

test("single occurrence editing retains the date identity and excludes only this occurrence", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  let current = { ...effective },
    writes = 0;
  await page.route(
    "**/test-api/api/tasks/series/occurrences?*",
    async (route) => {
      expect(
        new URL(route.request().url()).searchParams.get("original_start"),
      ).toBe(at);
      if (route.request().method() === "PATCH") {
        writes++;
        const draft = route.request().postDataJSON();
        expect(draft.recurrence).toBeUndefined();
        expect(draft.schedule_type).toBeUndefined();
        current = { ...current, ...draft, id: "child" };
      }
      return route.fulfill({ json: current });
    },
  );
  await page.goto(href);
  await expect(
    page.getByRole("link", { name: "전체 반복 수정", exact: true }),
  ).toHaveAttribute("href", "/tasks/series");
  await page
    .getByRole("button", { name: "이번 일정만 수정", exact: true })
    .click();
  await expect(page.getByLabel("반복 주기", { exact: true })).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "일정명", exact: true })
    .fill("이번 주 회의 변경");
  await page.getByLabel("시작 일시", { exact: true }).fill("2026-11-09T17:00");
  const check = page.waitForRequest((r) =>
    r.url().endsWith("/api/schedules/conflicts"),
  );
  await page
    .getByRole("button", { name: "변경 사항 저장", exact: true })
    .click();
  expect((await check).postDataJSON()).toMatchObject({
    exclude_occurrence_task_id: "series",
    exclude_occurrence_start: at,
  });
  await expect(
    page.getByRole("heading", { name: "이번 주 회의 변경", exact: true }),
  ).toBeVisible();
  expect(writes).toBe(1);
  await page
    .getByRole("main")
    .screenshot({ path: test.info().outputPath("occurrence-detail.png") });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("single deletion needs confirmation and can retry without deleting the series", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  let writes = 0;
  await page.route("**/test-api/api/tasks/series/occurrences?*", (route) => {
    if (route.request().method() === "DELETE") {
      writes++;
      return writes === 1
        ? route.fulfill({
            status: 503,
            json: { detail: "삭제하지 못했습니다. 다시 시도해 주세요." },
          })
        : route.fulfill({ status: 204, body: "" });
    }
    return route.fulfill({ json: effective });
  });
  let wholeDeletes = 0;
  page.on("request", (r) => {
    if (
      r.method() === "DELETE" &&
      new URL(r.url()).pathname.endsWith("/api/tasks/series")
    )
      wholeDeletes++;
  });
  await page.goto(href);
  await page
    .getByRole("button", { name: "이번 일정만 삭제", exact: true })
    .click();
  expect(writes).toBe(0);
  const confirm = page.getByRole("button", {
    name: "이번 일정 삭제 확인",
    exact: true,
  });
  await confirm.click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await confirm.click();
  await expect(page).toHaveURL(/\/calendar$/);
  expect(writes).toBe(2);
  expect(wholeDeletes).toBe(0);
});

test("calendar recurring entries link to their selected date and series edits confirm resets", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-11-09T03:00:00Z"));
  await mockApi(page, [], { tasks: [{ ...parent, exception_count: 1 }] });
  await login(page);
  await page.route("**/test-api/api/calendar/registrations?*", (route) =>
    route.fulfill({
      json: {
        entries: [
          {
            id: "series",
            kind: "fixed_task",
            title: "주간 회의",
            start_at: at,
            end_at: "2026-11-09T07:00:00Z",
            is_recurring: true,
            is_confirmed: true,
            is_completed: false,
          },
        ],
        has_more: false,
      },
    }),
  );
  await page.goto("/calendar");
  const links = page.getByRole("link", { name: /주간 회의/ });
  await expect(links.first()).toHaveAttribute("href", href);
  await page.goto("/tasks/series");
  await page.getByRole("button", { name: "일정 수정", exact: true }).click();
  await page.getByLabel("개별 변경 초기화", { exact: false }).check();
  const sent = page.waitForRequest(
    (r) => r.method() === "PATCH" && r.url().endsWith("/api/tasks/series"),
  );
  await page
    .getByRole("button", { name: "변경 사항 저장", exact: true })
    .click();
  expect((await sent).postDataJSON().reset_occurrences).toBe(true);
});
