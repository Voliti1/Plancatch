import { expect, test } from "@playwright/test";
import { mockApi, user } from "./fixtures";

async function mockGoogle(
  page: import("@playwright/test").Page,
  hasPassword: boolean,
) {
  await mockApi(page);
  await page.route("**/api/auth/google/challenge", (route) =>
    route.fulfill({
      json: {
        client_id: "test.apps.googleusercontent.com",
        nonce: "test-nonce",
      },
    }),
  );
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ json: { ...user, password_enabled: hasPassword } }),
  );
  await page.route("https://accounts.google.com/gsi/client", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `window.google={accounts:{id:{
        initialize(options){this.send=options.callback;},
        renderButton(el, options){const b=document.createElement('button'); b.textContent='구글로 계속하기'; b.dataset.googleType=options.type; b.dataset.googleTheme=options.theme; b.dataset.googleShape=options.shape;b.onclick=()=>this.send({credential:'test-only-id-token'});el.append(b);}
      }}};`,
    }),
  );
  await page.route("**/api/auth/google", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.credential).toBe("test-only-id-token");
    if (hasPassword && !body.current_password)
      return route.fulfill({
        status: 409,
        json: { detail: "google_login_password_required" },
      });
    if (hasPassword) expect(body.current_password).toBe("existing-password");
    return route.fulfill({
      json: {
        access_token: "test-only-placeholder",
        token_type: "bearer",
        expires_in: 86400,
      },
    });
  });
}

test("Google-only accounts can sign in and do not show password changes", async ({
  page,
}) => {
  await mockGoogle(page, false);
  await page.goto("/login");
  await page.getByRole("button", { name: "구글로 계속하기" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("button", { name: "설정 열기" }).click();
  const settings = page.getByRole("dialog", { name: "설정" });
  await expect(
    settings.getByText("스캔 PDF 전송 동의", { exact: true }),
  ).toHaveCount(0);
  await expect(
    settings.getByText("구글 캘린더 연결", { exact: true }),
  ).toHaveCount(0);
  await expect(
    settings.getByText("카카오 캘린더 연결", { exact: true }),
  ).toHaveCount(0);
  await expect(
    settings.getByRole("heading", { name: "비밀번호 변경" }),
  ).toHaveCount(0);
});

test("an existing email account supplies its password to link Google and keeps password settings", async ({
  page,
}) => {
  await mockGoogle(page, true);
  await page.goto("/login");
  await page.getByRole("button", { name: "구글로 계속하기" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("현재 플랜캐치 비밀번호").fill("existing-password");
  await page.getByRole("button", { name: "구글 계정 연결 후 로그인" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("button", { name: "설정 열기" }).click();
  await expect(
    page.getByRole("heading", { name: "비밀번호 변경" }),
  ).toBeVisible();
});

test("guest theme toggle updates the centered Google icon and persists", async ({
  page,
}) => {
  await mockGoogle(page, false);
  await page.goto("/login");
  const google = page.getByRole("button", { name: "구글로 계속하기" });
  await expect(page.getByText("간편 로그인", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "카카오 로그인" })).toHaveCount(
    0,
  );
  await expect(google).toHaveAttribute("data-google-type", "icon");
  await expect(google).toHaveAttribute("data-google-shape", "circle");
  await expect(google).toHaveAttribute("data-google-theme", "outline");
  const group = page.locator(".social-login-buttons");
  await expect(group.getByRole("button")).toHaveCount(1);

  await page.getByRole("button", { name: "다크 모드로 전환" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(google).toHaveAttribute("data-google-theme", "outline_dark");
  await page.getByRole("link", { name: "회원가입" }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByRole("button", { name: "카카오 로그인" })).toHaveCount(
    0,
  );
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(google).toHaveAttribute("data-google-theme", "outline_dark");
  await page.getByRole("button", { name: "라이트 모드로 전환" }).click();
  await expect(google).toHaveAttribute("data-google-theme", "outline");
});
