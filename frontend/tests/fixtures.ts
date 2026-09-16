// Test-only API responses. Production features never import these fixtures.
import { expect, type Page } from "@playwright/test";
import type { Deadline, Source } from "../types/api";
export const user = {
  id: "test-user",
  email: "tester@example.com",
  display_name: "테스터",
  is_active: true,
  created_at: "2026-09-16T00:00:00Z",
};
export async function mockApi(page: Page) {
  const sources: Source[] = [];
  let deadlines: Deadline[] = [];
  await page.route("**/test-api/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/test-api", "");
    const method = request.method();
    if (path === "/api/auth/signup") {
      const body = request.postDataJSON();
      expect(body.password.length).toBeGreaterThanOrEqual(8);
      return route.fulfill({ status: 201, json: user });
    }
    if (path === "/api/auth/login")
      return route.fulfill({
        json: {
          access_token: "test-only-placeholder",
          token_type: "bearer",
          expires_in: 3600,
        },
      });
    expect(request.headers().authorization).toBe(
      "Bearer test-only-placeholder",
    );
    if (path === "/api/auth/me") return route.fulfill({ json: user });
    if (path === "/api/sources") {
      if (method === "POST") {
        const source = {
          id: `source-${sources.length + 1}`,
          original_url: null,
          original_text: null,
          title: null,
          extracted_text: null,
          storage_key: null,
          processing_status: "pending",
          error_message: null,
          created_at: "2026-09-16T00:00:00Z",
          updated_at: "2026-09-16T00:00:00Z",
          ...request.postDataJSON(),
        };
        sources.push(source);
        return route.fulfill({ status: 201, json: source });
      }
      return route.fulfill({ json: sources });
    }
    if (path === "/api/deadlines") {
      if (method === "POST") {
        const deadline = {
          id: "deadline-1",
          confidence: null,
          evidence_text: null,
          created_at: "2026-09-16T00:00:00Z",
          updated_at: "2026-09-16T00:00:00Z",
          ...request.postDataJSON(),
        };
        deadlines.push(deadline);
        return route.fulfill({ status: 201, json: deadline });
      }
      return route.fulfill({ json: deadlines });
    }
    if (path === "/api/deadlines/deadline-1") {
      if (method === "DELETE") {
        deadlines = [];
        return route.fulfill({ status: 204 });
      }
      if (method === "PATCH")
        deadlines[0] = { ...deadlines[0], ...request.postDataJSON() };
      return route.fulfill({ json: deadlines[0] });
    }
    return route.fulfill({ status: 404, json: { detail: "Not found" } });
  });
}
export async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("이메일", { exact: true }).fill(user.email);
  await page.getByLabel("비밀번호", { exact: true }).fill("Test-password-123");
  await page.getByRole("button", { name: "로그인 →" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole("heading", { name: "테스터님, 오늘도 차근차근." }),
  ).toBeVisible();
}
