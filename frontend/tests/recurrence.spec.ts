import { expect, test } from "@playwright/test";
import { login, mockApi } from "./fixtures";

test("direct repeat registration, series editing and removal of recurrence", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  await page.goto("/sources/new?mode=manual");
  await page
    .getByRole("textbox", { name: "일정명", exact: true })
    .fill("주간 팀 회의");
  await page.getByLabel("시작 일시", { exact: true }).fill("2026-11-16T15:00");
  await page.getByLabel("반복 주기", { exact: true }).selectOption("weekly");
  await page.getByLabel("반복 간격 (주)", { exact: true }).fill("2");
  await page.getByLabel("반복 종료", { exact: true }).selectOption("count");
  await page.getByLabel("반복 횟수 (첫 일정 포함)", { exact: true }).fill("5");
  await expect(
    page.getByText("수정·삭제는 반복 일정 전체에 적용됩니다.", {
      exact: false,
    }),
  ).toBeVisible();
  const posted = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/api/tasks"),
  );
  await page.getByRole("button", { name: "일정 등록", exact: true }).click();
  expect((await posted).postDataJSON()).toMatchObject({
    recurrence: { frequency: "weekly", interval: 2, count: 5, until: null },
    earliest_start: "2026-11-16T06:00:00.000Z",
    latest_end: "2026-11-16T07:00:00.000Z",
  });
  await expect(
    page.getByText("반복: 2주마다 반복 · 5회", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "이 반복 일정 전체와 Google에 연결된 반복 일정이 삭제됩니다.",
      { exact: false },
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "일정 수정", exact: true }).click();
  await expect(page.getByLabel("반복 간격 (주)", { exact: true })).toHaveValue(
    "2",
  );
  await page.getByLabel("반복 주기", { exact: true }).selectOption("monthly");
  await page.getByLabel("반복 종료", { exact: true }).selectOption("until");
  await page.getByLabel("반복 종료일", { exact: true }).fill("2027-05-16");
  const patched = page.waitForRequest(
    (r) => r.method() === "PATCH" && r.url().includes("/api/tasks/"),
  );
  await page
    .getByRole("button", { name: "변경 사항 저장", exact: true })
    .click();
  expect((await patched).postDataJSON().recurrence).toEqual({
    frequency: "monthly",
    interval: 2,
    count: null,
    until: "2027-05-16",
  });
  await page.getByRole("button", { name: "일정 수정", exact: true }).click();
  await page.getByLabel("반복 주기", { exact: true }).selectOption("none");
  const cleared = page.waitForRequest(
    (r) => r.method() === "PATCH" && r.url().includes("/api/tasks/"),
  );
  await page
    .getByRole("button", { name: "변경 사항 저장", exact: true })
    .click();
  expect((await cleared).postDataJSON().recurrence).toBeNull();
});

test("sentence repeat stays editable and deadline mode does not send recurrence", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  await page.route("**/test-api/api/schedules/interpret", (route) =>
    route.fulfill({
      json: {
        kind: "task",
        title: "회의",
        start_at: "2026-11-16T15:00:00+09:00",
        end_at: "2026-11-16T16:00:00+09:00",
        reference_at: "2026-11-10T12:00:00+09:00",
        timezone: "Asia/Seoul",
        notices: [],
        recurrence: {
          frequency: "weekly",
          interval: 1,
          count: null,
          until: null,
        },
      },
    }),
  );
  await page.goto("/sources/new?mode=natural");
  await page
    .getByLabel("일정 설명", { exact: true })
    .fill("매주 월요일 오후3시 회의");
  await expect(page.getByLabel("반복 주기", { exact: true })).toHaveValue(
    "weekly",
  );
  await page.getByLabel("반복 종료", { exact: true }).selectOption("until");
  await page.getByLabel("반복 종료일", { exact: true }).fill("2026-11-01");
  await page.getByRole("button", { name: "일정 등록", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "반복 종료일은 첫 일정 날짜 이후",
  );
  await page.getByLabel("반복 종료일", { exact: true }).fill("2027-01-01");
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await page
    .locator(".natural-preview")
    .screenshot({ path: test.info().outputPath("repeat-registration.png") });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "마감일", exact: true }).click();
  await expect(page.getByLabel("반복 주기", { exact: true })).toHaveCount(0);
  const posted = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/api/deadlines"),
  );
  await page.getByRole("button", { name: "마감일 등록", exact: true }).click();
  expect((await posted).postDataJSON()).not.toHaveProperty("recurrence");
});

test("weekly timetable shows each occurrence of the same series", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await page.route("**/test-api/api/calendar/registrations?*", (route) =>
    route.fulfill({
      json: {
        entries: [16, 17, 18].map((day) => ({
          id: "repeated-task",
          kind: "fixed_task",
          title: "매일 회의",
          is_recurring: true,
          start_at: `2026-11-${day}T06:00:00Z`,
          end_at: `2026-11-${day}T07:00:00Z`,
          is_confirmed: true,
          is_completed: false,
        })),
        has_more: false,
      },
    }),
  );
  await page.goto("/calendar?date=2026-11-16");
  await page.getByRole("button", { name: "주간", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "주간 시간표" })
      .getByRole("link", { name: /매일 회의/ }),
  ).toHaveCount(3);
  expect(errors.filter((error) => /same key|unique.*key/i.test(error))).toEqual(
    [],
  );
});
