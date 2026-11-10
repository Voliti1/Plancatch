import { expect, test } from "@playwright/test";
import { login, mockApi } from "./fixtures";

const empty = {
  conflicts: [],
  truncated: false,
  coverage_limited: false,
  is_recurring: false,
  checked_from: "2026-11-16T06:00:00Z",
  checked_until: "2026-11-16T07:00:00Z",
};
async function open(page: import("@playwright/test").Page) {
  await mockApi(page);
  await login(page);
  await page.goto("/sources/new?mode=manual");
  await page
    .getByRole("textbox", { name: "일정명", exact: true })
    .fill("새 회의");
  await page.getByLabel("시작 일시", { exact: true }).fill("2026-11-16T15:00");
}

test("Google busy conflicts show provider and all-day labels before explicit save", async ({
  page,
}) => {
  await open(page);
  let checks = 0,
    writes = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/tasks")) writes++;
  });
  await page.route("**/test-api/api/schedules/conflicts", (route) => {
    checks++;
    return route.fulfill({
      json: {
        ...empty,
        google_state: "checked",
        google_message: null,
        conflicts: [
          {
            id: "provider-only",
            kind: "google",
            task_id: null,
            title: "구글 캘린더에서 등록한 휴가",
            start_at: "2026-11-15T15:00:00Z",
            end_at: "2026-11-16T15:00:00Z",
            is_all_day: true,
            is_recurring: false,
          },
        ],
      },
    });
  });
  await page.getByRole("button", { name: "일정 등록", exact: true }).click();
  const warning = page.getByRole("region", {
    name: "시간이 겹치는 일정이 있습니다",
    exact: true,
  });
  await expect(warning).toContainText("구글 캘린더에서 등록한 휴가");
  await expect(warning).toContainText("Google Calendar · 종일");
  await expect(warning.locator('a[href*="/tasks/"]')).toHaveCount(0);
  expect(writes).toBe(0);
  await warning.screenshot({
    path: test.info().outputPath("google-overlap.png"),
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await warning
    .getByRole("button", { name: "겹쳐도 저장", exact: true })
    .click();
  await expect(page).toHaveURL(/\/tasks\/task-1$/);
  expect(writes).toBe(1);
  expect(checks).toBe(1);
});

for (const state of ["partial", "unavailable", "reconnect_required"]) {
  test(`Google ${state} never means there are no conflicts`, async ({
    page,
  }) => {
    await open(page);
    let writes = 0;
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().endsWith("/api/tasks")) writes++;
    });
    await page.route("**/test-api/api/schedules/conflicts", (route) =>
      route.fulfill({
        json: {
          ...empty,
          google_state: state,
          google_message:
            state === "partial"
              ? "일부 구글 일정만 확인했습니다."
              : "구글 일정을 확인하지 못했습니다.",
        },
      }),
    );
    await page.getByRole("button", { name: "일정 등록", exact: true }).click();
    const warning = page.getByRole("region", {
      name: "구글 일정 확인이 필요합니다",
      exact: true,
    });
    await expect(warning).toBeVisible();
    expect(writes).toBe(0);
    if (state === "reconnect_required")
      await expect(
        warning.getByRole("link", {
          name: "구글 계정 연결 확인 →",
          exact: true,
        }),
      ).toHaveAttribute("href", "/settings/google-calendar");
    await warning
      .getByRole("button", { name: "구글 확인 없이 저장", exact: true })
      .click();
    await expect(page).toHaveURL(/\/tasks\/task-1$/);
    expect(writes).toBe(1);
  });
}

test("local conflicts survive Google failure and a normal save retries the read", async ({
  page,
}) => {
  await open(page);
  let reads = 0;
  await page.route("**/test-api/api/schedules/conflicts", (route) => {
    reads++;
    return route.fulfill({
      json: {
        ...empty,
        google_state: reads === 1 ? "unavailable" : "checked",
        google_message: reads === 1 ? "구글 읽기에 실패했습니다." : null,
        conflicts:
          reads === 1
            ? [
                {
                  id: "local",
                  task_id: "local",
                  kind: "task",
                  title: "기존 로컬 회의",
                  start_at: empty.checked_from,
                  end_at: empty.checked_until,
                  is_recurring: false,
                },
              ]
            : [],
      },
    });
  });
  const save = page.getByRole("button", { name: "일정 등록", exact: true });
  await save.click();
  await expect(
    page.getByRole("region", {
      name: "시간이 겹치는 일정이 있습니다",
      exact: true,
    }),
  ).toContainText("기존 로컬 회의");
  await save.click();
  await expect(page).toHaveURL(/\/tasks\/task-1$/);
  expect(reads).toBe(2);
});
