import { expect, test, type Page } from "@playwright/test";
import { login, mockApi } from "./fixtures";

const emptyStatus = {
  configured: true,
  connected: false,
  reconnect_required: false,
  pending: false,
  connected_at: null,
  refresh_expires_at: null,
};
const googleUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?state=synthetic-only";

async function setup(page: Page, initial = {}) {
  await mockApi(page);
  let status = { ...emptyStatus, ...initial };
  const requests: string[] = [];
  await page.route(
    "**/test-api/api/integrations/google-calendar/**",
    async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      requests.push(
        request.method() + " " + path.split("/google-calendar/")[1],
      );
      expect(request.headers().authorization).toBe(
        "Bearer test-only-placeholder",
      );
      if (path.endsWith("/status")) return route.fulfill({ json: status });
      if (path.endsWith("/connect"))
        return route.fulfill({
          json: { authorization_url: googleUrl, expires_in: 600 },
          headers: {
            "Set-Cookie":
              "plancatch_google_oauth=synthetic-only; Path=/test-api/api/integrations/google-calendar/callback; HttpOnly; SameSite=Lax",
          },
        });
      if (path.endsWith("/connection")) {
        status = { ...emptyStatus };
        return route.fulfill({
          json: {
            disconnected: true,
            google_revoked: true,
            manual_revoke_required: false,
          },
        });
      }
      return route.fulfill({ status: 404, json: {} });
    },
  );
  await login(page);
  await page
    .getByRole("link", { name: "구글 캘린더 연결", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "구글 캘린더 연결", exact: true }),
  ).toBeVisible();
  return { requests };
}

test("연결은 명시적 클릭만 시작하고 서버 상태를 표시한다", async ({ page }) => {
  const { requests } = await setup(page);
  await expect(
    page.getByText("아직 연결하지 않았습니다", { exact: true }),
  ).toBeVisible();
  expect(requests.every((item) => item === "GET status")).toBeTruthy();
  await expect(page.getByText(/연결해도 일정이 자동 등록되거나/)).toBeVisible();
  await page.getByRole("button", { name: "상태 다시 확인" }).click();
  await expect(
    page.getByText("아직 연결하지 않았습니다", { exact: true }),
  ).toBeVisible();
});

test("서버 설정이 없으면 연결 시작 버튼은 없다", async ({ page }) => {
  await setup(page, { configured: false });
  await expect(
    page.getByText("서버 연결 설정이 필요합니다", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Google 계정 연결", exact: true }),
  ).toHaveCount(0);
});

test("연결됨과 재연결 필요 상태를 구분한다", async ({ page }) => {
  await setup(page, { connected: true });
  await expect(
    page.getByText("Google Calendar 연결됨", { exact: true }),
  ).toBeVisible();
  await page.route("**/google-calendar/status", (route) =>
    route.fulfill({ json: { ...emptyStatus, reconnect_required: true } }),
  );
  await page.getByRole("button", { name: "상태 다시 확인" }).click();
  await expect(
    page.getByText("재연결이 필요합니다", { exact: true }),
  ).toBeVisible();
});

test("연결 시작은 쿠키를 보관하고 Google의 고정 주소로 이동한다", async ({
  page,
}) => {
  const { requests } = await setup(page);
  await page.route("https://accounts.google.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "Synthetic Google approval; no real account accessed",
    }),
  );
  await page
    .getByRole("button", { name: "Google 계정 연결", exact: true })
    .click();
  await expect(page).toHaveURL(googleUrl);
  expect(requests.filter((item) => item === "POST connect")).toHaveLength(1);
  const cookies = await page
    .context()
    .cookies(
      "http://127.0.0.1:3100/test-api/api/integrations/google-calendar/callback",
    );
  expect(
    cookies.find((cookie) => cookie.name === "plancatch_google_oauth")
      ?.httpOnly,
  ).toBe(true);
});

test("서버가 잘못된 인증 주소를 주면 외부 이동을 막는다", async ({ page }) => {
  await setup(page);
  await page.route("**/google-calendar/connect", (route) =>
    route.fulfill({
      json: {
        authorization_url:
          "https://accounts.google.com.evil.example/o/oauth2/v2/auth",
        expires_in: 600,
      },
    }),
  );
  await page
    .getByRole("button", { name: "Google 계정 연결", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "구글 계정 연결 설정" })
      .getByRole("alert"),
  ).toContainText("안전한 Google 인증 주소");
  await expect(page).toHaveURL(/\/settings\/google-calendar$/);
});

test("연결 해제는 확인 후에만 수행하고 취소하면 유지한다", async ({ page }) => {
  const { requests } = await setup(page, { connected: true });
  await page.getByRole("button", { name: "연결 해제", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "취소", exact: true }).click();
  expect(requests).not.toContain("DELETE connection");
  await page.getByRole("button", { name: "연결 해제", exact: true }).click();
  await page
    .getByRole("button", { name: "연결 해제 확인", exact: true })
    .click();
  await expect(
    page.getByText("아직 연결하지 않았습니다", { exact: true }),
  ).toBeVisible();
  expect(requests.filter((item) => item === "DELETE connection")).toHaveLength(
    1,
  );
});

test("철회 실패 시 로컬 해제와 Google 수동 해제 안내를 구분한다", async ({
  page,
}) => {
  await setup(page, { connected: true });
  await page.route("**/google-calendar/connection", (route) =>
    route.fulfill({
      json: {
        disconnected: true,
        google_revoked: false,
        manual_revoke_required: true,
      },
    }),
  );
  await page.getByRole("button", { name: "연결 해제", exact: true }).click();
  await page
    .getByRole("button", { name: "연결 해제 확인", exact: true })
    .click();
  await expect(
    page.getByText(/Google 권한 철회는 확인하지 못했으니/),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Google 계정 연결 관리 ↗" }),
  ).toHaveAttribute("href", "https://myaccount.google.com/connections");
});

test("연결 오류는 재시도 가능하고 상태 조회 실패를 연결 해제로 오인하지 않는다", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/google-calendar/connect", (route) =>
    route.fulfill({
      status: 409,
      json: {
        detail: "등록한 Google 콜백과 동일한 API 주소로 연결을 시작해 주세요.",
      },
    }),
  );
  await page
    .getByRole("button", { name: "Google 계정 연결", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "구글 계정 연결 설정" })
      .getByRole("alert"),
  ).toContainText("동일한 API 주소");
  await expect(
    page.getByRole("button", { name: "Google 계정 연결", exact: true }),
  ).toBeEnabled();
  await page.route("**/google-calendar/status", (route) =>
    route.fulfill({
      status: 503,
      json: { detail: "잠시 후 다시 시도해 주세요." },
    }),
  );
  await page.getByRole("button", { name: "상태 다시 확인" }).click();
  await expect(
    page.getByText("잠시 후 다시 시도해 주세요.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("아직 연결하지 않았습니다", { exact: true }),
  ).toHaveCount(0);
});

test("페이지 이탈 후 늦은 연결 응답은 Google로 이동시키지 않는다", async ({
  page,
}) => {
  await setup(page);
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const requested = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route("**/google-calendar/connect", async (route) => {
    started();
    await wait;
    await route.fulfill({
      json: { authorization_url: googleUrl, expires_in: 600 },
    });
  });
  await page
    .getByRole("button", { name: "Google 계정 연결", exact: true })
    .click();
  await requested;
  await page.getByRole("link", { name: "대시보드", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const response = page.waitForResponse((item) =>
    item.url().endsWith("/google-calendar/connect"),
  );
  release();
  await response;
  await expect(page).toHaveURL(/\/dashboard$/);
});
