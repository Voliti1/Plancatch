import { expect, test } from "@playwright/test";
import { mockApi, user } from "./fixtures";

test("retires the temporary session after forcing a password change", async ({
  page,
}) => {
  await mockApi(page);
  await page.route("**/api/auth/password-recovery", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ email: user.email });
    await route.fulfill({ status: 202, json: { accepted: true } });
  });
  await page.route("**/api/auth/login", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      email: user.email,
      password: "temporary-test-only",
    });
    await route.fulfill({
      json: {
        access_token: "restricted-test-token",
        token_type: "bearer",
        expires_in: 900,
      },
    });
  });
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      json: {
        ...user,
        password_change_required:
          route.request().headers().authorization ===
          "Bearer restricted-test-token",
      },
    });
  });
  await page.route("**/api/auth/password", async (route) => {
    expect(route.request().headers().authorization).toBe(
      "Bearer restricted-test-token",
    );
    expect(route.request().postDataJSON()).toEqual({
      current_password: "temporary-test-only",
      new_password: "new-test-password",
    });
    await route.fulfill({
      json: {
        access_token: "regular-test-token",
        token_type: "bearer",
        expires_in: 86400,
      },
    });
  });

  await page.goto("/login");
  await page.getByRole("link", { name: "비밀번호 찾기" }).click();
  await page.getByLabel("가입 이메일").fill(user.email);
  await page.getByRole("button", { name: "임시 비밀번호 받기" }).click();
  await expect(page.getByRole("status")).toContainText("요청을 받았습니다");
  await page.getByRole("link", { name: "로그인으로 돌아가기" }).click();
  await page.getByLabel("이메일").fill(user.email);
  await page
    .getByLabel("비밀번호", { exact: true })
    .fill("temporary-test-only");
  await page.getByRole("button", { name: "로그인 →" }).click();
  await expect(page).toHaveURL(/\/password-recovery\/change$/);
  await page.goto("/calendar");
  await expect(page).toHaveURL(/\/password-recovery\/change$/);
  await page
    .getByLabel("임시 비밀번호", { exact: true })
    .fill("temporary-test-only");
  await page
    .getByLabel("새 비밀번호", { exact: true })
    .fill("new-test-password");
  await page
    .getByLabel("새 비밀번호 확인", { exact: true })
    .fill("new-test-password");
  await page.getByRole("button", { name: "새 비밀번호 저장" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});
