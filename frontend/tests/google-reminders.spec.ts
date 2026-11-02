import { test, expect } from "@playwright/test";
import { mockApi, login } from "./fixtures";
import { calendarTask } from "./calendar-fixtures";

test("custom browser and email reminders save with a task and remain editable", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  await page.goto("/sources/new?mode=manual");
  await expect(
    page.getByLabel("구글 캘린더 알림", { exact: true }),
  ).toHaveValue("none");
  await page.getByLabel("일정명", { exact: true }).fill("알림 있는 회의");
  await page.getByLabel("시작 일시", { exact: true }).fill("2026-11-15T10:00");
  await page.getByLabel("종료 일시", { exact: true }).fill("2026-11-15T11:00");
  await page
    .getByLabel("구글 캘린더 알림", { exact: true })
    .selectOption("custom");
  await page.getByRole("button", { name: "알림 추가", exact: true }).click();
  await page.getByLabel("알림 2 방식", { exact: true }).selectOption("email");
  await page.getByLabel("알림 2 시간 (분 전)", { exact: true }).fill("1440");
  const sent = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/api/tasks"),
  );
  await page.getByRole("button", { name: "일정 등록", exact: true }).click();
  expect((await sent).postDataJSON().google_reminders).toEqual({
    mode: "custom",
    overrides: [
      { method: "popup", minutes: 30 },
      { method: "email", minutes: 1440 },
    ],
  });
  await expect(page).toHaveURL(/\/tasks\/task-1$/);
  await expect(
    page.getByText(/구글 캘린더 알림:.*1일 전 이메일/),
  ).toBeVisible();
  await page.getByRole("button", { name: "일정 수정", exact: true }).click();
  await expect(
    page.getByLabel("알림 2 시간 (분 전)", { exact: true }),
  ).toHaveValue("1440");
});

test("invalid or duplicate reminder times cannot register and deadline mode sends none", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  await page.goto("/sources/new?mode=manual");
  await page.getByRole("button", { name: "마감일", exact: true }).click();
  await page.getByLabel("일정명", { exact: true }).fill("알림 없는 마감");
  await page.getByLabel("종료 일시", { exact: true }).fill("2026-11-15T23:59");
  await page
    .getByLabel("구글 캘린더 알림", { exact: true })
    .selectOption("custom");
  await page.getByLabel("알림 1 시간 (분 전)", { exact: true }).fill("-1");
  await page.getByRole("button", { name: "마감일 등록", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "알림 시간",
  );
  await page.getByLabel("알림 1 시간 (분 전)", { exact: true }).fill("60");
  await page.getByRole("button", { name: "알림 추가", exact: true }).click();
  await page.getByRole("button", { name: "마감일 등록", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("중복");
  await page
    .getByLabel("구글 캘린더 알림", { exact: true })
    .selectOption("none");
  await expect(page.getByLabel("알림 1 방식", { exact: true })).toHaveCount(0);
  const sent = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/api/deadlines"),
  );
  await page.getByRole("button", { name: "마감일 등록", exact: true }).click();
  expect((await sent).postDataJSON().google_reminders).toEqual({
    mode: "none",
    overrides: [],
  });
  await expect(page).toHaveURL(/\/deadlines\/deadline-1$/);
});

test("legacy item edits keep Google's existing reminder choices unless the user opts in", async ({
  page,
}) => {
  await mockApi(page, [], { tasks: [calendarTask] });
  await login(page);
  await page.goto(`/tasks/${calendarTask.id}`);
  await page.getByRole("button", { name: "일정 수정", exact: true }).click();
  await expect(
    page.getByLabel("구글 캘린더 알림", { exact: true }),
  ).toHaveValue("preserve");
  await page
    .getByLabel("일정명", { exact: true })
    .fill("기존 일정 이름만 변경");
  const sent = page.waitForRequest(
    (r) => r.method() === "PATCH" && r.url().includes("/api/tasks/"),
  );
  await page
    .getByRole("button", { name: "변경 사항 저장", exact: true })
    .click();
  expect((await sent).postDataJSON()).not.toHaveProperty("google_reminders");
});
