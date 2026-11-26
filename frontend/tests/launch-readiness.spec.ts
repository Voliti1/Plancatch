import { test, expect } from "@playwright/test";
import { mockApi, login, user } from "./fixtures";

for (const social of [false, true]) {
  test(`account deletion has two-step proof and clears session after success (${social ? "social" : "password"})`, async ({
    page,
  }) => {
    await mockApi(page);
    if (social)
      await page.route("**/api/auth/me", (route) =>
        route.fulfill({ json: { ...user, password_enabled: false } }),
      );
    await login(page);
    await page.getByRole("button", { name: "설정 열기" }).click();
    const section = page.getByRole("region", {
      name: "회원 탈퇴",
      exact: true,
    });
    await expect(
      section.getByRole("button", { name: "확인하고 영구 탈퇴" }),
    ).toHaveCount(0);
    await section.getByRole("button", { name: "회원 탈퇴 진행" }).click();
    await section
      .getByRole("button", { name: "탈퇴 취소", exact: true })
      .click();
    await expect(
      section.getByRole("button", { name: "회원 탈퇴 진행" }),
    ).toBeVisible();
    await section.getByRole("button", { name: "회원 탈퇴 진행" }).click();
    let writes = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/auth/delete", async (route) => {
      writes++;
      expect(route.request().postDataJSON()).toEqual(
        social
          ? { confirmation_email: user.email }
          : { current_password: "password123" },
      );
      await gate;
      await route.fulfill({ status: 204 });
    });
    const proof = section.getByLabel(
      social ? "탈퇴 확인 이메일" : "탈퇴 확인 비밀번호",
    );
    await proof.fill(social ? user.email : "password123");
    await section.getByRole("button", { name: "확인하고 영구 탈퇴" }).click();
    await expect(section.getByRole("alert")).toContainText(
      "본인 확인 정보와 삭제 확인",
    );
    expect(writes).toBe(0);
    await section.getByRole("checkbox").check();
    await section.getByRole("button", { name: "확인하고 영구 탈퇴" }).click();
    await expect(
      page.getByRole("button", { name: "설정 닫기" }),
    ).toBeDisabled();
    await expect(proof).toBeDisabled();
    expect(writes).toBe(1);
    release();
    await expect(page).toHaveURL(/\/login$/);
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("plancatch.access_token"),
      ),
    ).toBeNull();
  });
}

test("failed deletion keeps the account and typed proof available for retry", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  await page.getByRole("button", { name: "설정 열기" }).click();
  const section = page.getByRole("region", { name: "회원 탈퇴", exact: true });
  await section.getByRole("button", { name: "회원 탈퇴 진행" }).click();
  await section.getByLabel("탈퇴 확인 비밀번호").fill("wrong-password");
  await section.getByRole("checkbox").check();
  await page.route("**/api/auth/delete", (route) =>
    route.fulfill({
      status: 400,
      json: { detail: "current_password_incorrect" },
    }),
  );
  await section.getByRole("button", { name: "확인하고 영구 탈퇴" }).click();
  await expect(section.getByRole("alert")).toContainText(
    "현재 비밀번호가 맞지 않아요",
  );
  await expect(section.getByLabel("탈퇴 확인 비밀번호")).toHaveValue(
    "wrong-password",
  );
  await expect(
    page.getByRole("dialog", { name: "설정", exact: true }),
  ).toBeVisible();
});

test("manual entry exposes category before the single collapsed settings panel", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  await page.goto("/sources/new?mode=manual");
  const category = page.getByLabel("카테고리", { exact: true });
  await expect(category).toBeVisible();
  await category.selectOption("study");
  await expect(page.locator(".manual-registration-card details")).toHaveCount(
    1,
  );
  await expect(page.getByLabel("우선순위", { exact: true })).toBeHidden();
  await page.getByLabel("일정명", { exact: true }).fill("분석 테스트");
  await page.getByLabel("시작 일시", { exact: true }).fill("2026-12-12T09:00");
  const sent = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/api/tasks"),
  );
  await page.getByRole("button", { name: "일정 등록", exact: true }).click();
  expect((await sent).postDataJSON().category).toBe("study");
});
