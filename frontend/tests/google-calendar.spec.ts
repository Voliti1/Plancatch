import { expect, test, type Page } from "@playwright/test";
import { login, mockApi } from "./fixtures";
import { workspaceLink } from "./workspace-navigation";

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
  const menu = page.getByRole("navigation", { name: "주 메뉴" });
  const connections = await workspaceLink(page, "구글 캘린더");
  await expect(connections).toHaveAttribute(
    "href",
    "/settings/google-calendar",
  );
  if (page.viewportSize()!.width > 760)
    await expect(menu.getByRole("link").last()).toHaveText(/구글 캘린더/);
  await connections.click();
  await expect(
    page.getByRole("heading", { name: "계정 연결 관리" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "구글 계정 연결 설정" }),
  ).toBeVisible();
  await expect(await workspaceLink(page, "구글 캘린더")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(
    page.getByRole("region", { name: "카카오 캘린더 연결" }),
  ).toContainText("추후 지원");
  await expect(
    page
      .getByRole("region", { name: "카카오 캘린더 연결" })
      .getByRole("button"),
  ).toHaveCount(0);
  return { requests };
}

test("연결은 명시적 클릭만 시작하고 서버 상태를 표시한다", async ({ page }) => {
  const { requests } = await setup(page);
  await expect(
    page.getByText("아직 연결하지 않았어요", { exact: true }),
  ).toBeVisible();
  expect(requests.every((item) => item === "GET status")).toBeTruthy();
  await expect(
    page.getByText("다른 앱에서 만든 구글 캘린더 일정은 변경하지 않아요."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "상태 다시 확인" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("아직 연결하지 않았어요", { exact: true }),
  ).toBeVisible();
});

test("서버 설정이 없으면 연결 시작 버튼은 없다", async ({ page }) => {
  await setup(page, { configured: false });
  await expect(
    page.getByText("서버 연결 설정이 필요해요", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "구글 계정 연결", exact: true }),
  ).toHaveCount(0);
});

test("연결 확인 중에는 상태를 다시 확인할 수 있다", async ({ page }) => {
  const { requests } = await setup(page, { pending: true });
  await expect(
    page.getByText("구글 계정 확인 진행 중", { exact: true }),
  ).toBeVisible();
  const reads = requests.filter((item) => item === "GET status").length;
  await page
    .getByRole("button", { name: "상태 다시 확인", exact: true })
    .click();
  await expect
    .poll(() => requests.filter((item) => item === "GET status").length)
    .toBeGreaterThan(reads);
  expect(requests.every((item) => item === "GET status")).toBeTruthy();
});

test("연결됨과 재연결 필요 상태를 구분한다", async ({ page }) => {
  await setup(page, { connected: true });
  await expect(
    page.getByText("구글 캘린더 연결됨", { exact: true }),
  ).toBeVisible();
  const actions = page.locator(".google-calendar-connection-actions");
  await expect(actions.getByRole("button")).toHaveCount(3);
  await expect(
    actions.getByRole("button", { name: "상태 다시 확인" }),
  ).toHaveCount(0);
  await expect(actions).toHaveCSS("gap", "8px");
  await expect(actions).toHaveCSS("flex-wrap", "wrap");
  await page.route("**/google-calendar/status", (route) =>
    route.fulfill({ json: { ...emptyStatus, reconnect_required: true } }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByText("재연결이 필요해요", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "상태 다시 확인" }).click();
  await expect(
    page.getByText("재연결이 필요해요", { exact: true }),
  ).toBeVisible();
});

test("연결 시작은 쿠키를 보관하고 구글의 고정 주소로 이동한다", async ({
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
    .getByRole("button", { name: "구글 계정 연결", exact: true })
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
    .getByRole("button", { name: "구글 계정 연결", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "구글 계정 연결 설정" })
      .getByRole("alert"),
  ).toContainText("안전한 구글 계정 확인 주소");
  await expect(page).toHaveURL(/\/settings\/connections(?:#google)?$/);
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
    page.getByText("아직 연결하지 않았어요", { exact: true }),
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
    page.getByText(/구글 쪽 연결 해제는 확인하지 못했어요/),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "구글 계정 연결 관리 ↗" }),
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
    .getByRole("button", { name: "구글 계정 연결", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "구글 계정 연결 설정" })
      .getByRole("alert"),
  ).toContainText("동일한 API 주소");
  await expect(
    page.getByRole("button", { name: "구글 계정 연결", exact: true }),
  ).toBeEnabled();
  await page.route("**/google-calendar/status", (route) =>
    route.fulfill({
      status: 503,
      json: { detail: "잠시 후 다시 시도해 주세요." },
    }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByText("잠시 후 다시 시도해 주세요.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("아직 연결하지 않았어요", { exact: true }),
  ).toHaveCount(0);
});

test("계정 연결 페이지 이탈 후 늦은 응답은 구글로 이동시키지 않는다", async ({
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
    .getByRole("button", { name: "구글 계정 연결", exact: true })
    .click();
  await requested;
  await page.getByRole("link", { name: "대시보드", exact: false }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const response = page.waitForResponse((item) =>
    item.url().endsWith("/google-calendar/connect"),
  );
  release();
  await response;
  await expect(page).toHaveURL(/\/dashboard$/);
});
