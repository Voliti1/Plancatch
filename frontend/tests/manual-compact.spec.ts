import { test, expect } from "@playwright/test";
import { login, mockApi } from "./fixtures";

for (const theme of ["light", "dark"] as const) {
  test(`compact manual form keeps optional settings collapsed in ${theme} mode`, async ({
    page,
  }) => {
    await mockApi(page);
    await login(page);
    await page.goto("/sources/new?mode=manual");
    await page
      .locator("html")
      .evaluate((node, theme) => node.setAttribute("data-theme", theme), theme);
    const card = page.locator(".manual-registration-card");
    await expect(
      card.getByRole("heading", { name: "직접 일정 만들기", exact: true }),
    ).toHaveCount(0);
    await expect(
      card.getByRole("link", { name: "등록한 일정 보기 →" }),
    ).toBeVisible();
    const settings = card.locator("details");
    await expect(settings).toHaveCount(1);
    await expect(settings).not.toHaveAttribute("open");
    await expect(card.getByLabel("일정명", { exact: true })).toBeVisible();
    await expect(card.getByLabel("시작 일시", { exact: true })).toBeVisible();
    await expect(
      card.getByLabel("메모 (선택)", { exact: true }),
    ).toHaveAttribute("rows", "2");
    await expect(card.getByLabel(/예상 소요시간/)).toHaveCount(0);
    await expect(card.getByLabel("카테고리", { exact: true })).toBeVisible();
    for (const name of ["우선순위", "반복 주기", "구글 캘린더 알림"]) {
      await expect(card.getByLabel(name, { exact: true })).toBeHidden();
    }
    await expect(
      card.getByLabel("변경한 세부 설정").locator("span"),
    ).toHaveCount(0);
    await expect(card.getByText(/저장 전에 플랜캐치의/)).toHaveCount(0);
    await settings.locator("summary").click();
    await card.getByLabel("우선순위", { exact: true }).selectOption("5");
    await card
      .getByLabel("구글 캘린더 알림", { exact: true })
      .selectOption("custom");
    await card.getByLabel("알림 1 방식", { exact: true }).selectOption("email");
    await card.getByLabel("알림 1 시간 (분 전)", { exact: true }).fill("15");
    await settings.locator("summary").click();
    await expect(settings.locator("summary")).toContainText(
      "우선순위 매우 높음",
    );
    await expect(settings.locator("summary")).toContainText("알림 설정");
    await card
      .getByLabel("일정명", { exact: true })
      .fill("간단 등록 회귀 검사");
    await card
      .getByLabel("시작 일시", { exact: true })
      .fill("2026-12-02T10:00");
    await expect(card.getByLabel("종료 일시", { exact: true })).toHaveValue(
      "2026-12-02T11:00",
    );
    await page.screenshot({
      path: test.info().outputPath(`compact-${theme}.png`),
      fullPage: true,
    });
    const posted = page.waitForRequest(
      (r) => r.method() === "POST" && r.url().endsWith("/api/tasks"),
    );
    await card.getByRole("button", { name: "일정 등록", exact: true }).click();
    expect((await posted).postDataJSON()).toMatchObject({
      priority: 5,
      schedule_type: "fixed",
      google_reminders: {
        mode: "custom",
        overrides: [{ method: "email", minutes: 15 }],
      },
    });
    await expect(page).toHaveURL(/\/tasks\/task-1$/);
  });
}

test("time-later toggle preserves duration and hidden advanced settings", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  await page.goto("/sources/new?mode=manual");
  const toggle = page.getByLabel("시간 나중에 정하기");
  await toggle.check();
  await expect(page.getByLabel("시작 일시", { exact: true })).toHaveCount(0);
  await page.getByLabel("예상 소요시간 (분, 필수)").fill("90");
  await toggle.uncheck();
  await expect(page.getByLabel(/예상 소요시간/)).toHaveCount(0);
  await page.getByLabel("시작 일시", { exact: true }).fill("2026-12-02T23:30");
  await expect(page.getByLabel("종료 일시", { exact: true })).toHaveValue(
    "2026-12-03T01:00",
  );
  await toggle.check();
  await expect(page.getByLabel("예상 소요시간 (분, 필수)")).toHaveValue("90");
  await page.getByLabel("일정명", { exact: true }).fill("나중에 배치할 작업");
  const posted = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/api/tasks"),
  );
  await page.getByRole("button", { name: "일정 등록", exact: true }).click();
  expect((await posted).postDataJSON()).toMatchObject({
    schedule_type: "flexible",
    estimated_minutes: 90,
    earliest_start: null,
    latest_end: null,
  });
});
