import { randomBytes } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import type { Deadline } from "../types/api";

const upstream = process.env.PLANCATCH_LIVE_API_URL?.trim().replace(/\/$/, "");
test.beforeAll(() => {
  if (!upstream)
    throw new Error(
      "PLANCATCH_LIVE_API_URL is required for explicit live testing",
    );
});

async function ownRequest(
  page: Page,
  path: string,
  method = "GET",
  body?: object,
) {
  // Only this test account's resources are read or removed; never return its token.
  return page.evaluate(
    async ({ path, method, body }) => {
      const response = await fetch(`/test-api${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${sessionStorage.getItem("plancatch.access_token")}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return {
        status: response.status,
        data: response.status === 204 ? null : await response.json(),
      };
    },
    { path, method, body },
  );
}

test("live test account: safety opt-in, server calculation, persistence, date update and disabling", async ({
  page,
}) => {
  const marker = `[테스트] Codex 안전 마감 ${randomBytes(5).toString("hex")}`;
  const email = `plancatch-safe-test-${randomBytes(8).toString("hex")}@example.com`;
  const password = randomBytes(24).toString("base64url");
  const ids: string[] = [];
  await page.route("**/test-api/api/**", async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({
      url: `${upstream}${url.pathname.replace("/test-api", "")}${url.search}`,
    });
    await route.fulfill({ response });
  });
  await page.goto("/signup");
  await page.getByLabel("이름 (선택)").fill("전용 안전 마감 테스트");
  await page.getByLabel("이메일", { exact: true }).fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByLabel("비밀번호 확인", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "계정 만들기 →", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "가입이 완료되었습니다.", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "로그인으로 이동", exact: true })
    .click();
  await page.getByLabel("이메일", { exact: true }).fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByRole("button", { name: "로그인 →", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  console.info("Live safety verification: dedicated test account signed in");
  try {
    await page.goto("/deadlines");
    await page.getByRole("button", { name: "＋ 마감일 등록" }).click();
    await expect(
      page.getByLabel("안전 마감일 사용", { exact: true }),
    ).not.toBeChecked();
    await page.getByLabel("마감 제목").fill(marker);
    await page.getByLabel("마감 일시 (한국 시간)").fill("2026-10-05T18:00");
    const created = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname.endsWith("/api/deadlines"),
    );
    await page
      .getByRole("button", { name: "마감일 등록", exact: true })
      .click();
    const response = await created;
    const deadline = (await response.json()) as Deadline;
    if (response.status() === 201) ids.push(deadline.id);
    expect(response.status()).toBe(201);
    expect(deadline.safety_buffer_minutes).toBeNull();
    expect(deadline.safe_due_at).toBeNull();
    await expect(page).toHaveURL(new RegExp(`/deadlines/${deadline.id}$`));
    await expect(page.getByLabel("저장된 마감일")).toContainText("미설정");
    await page.getByLabel("안전 마감일 사용", { exact: true }).check();
    await page.getByLabel("여유시간 (일)", { exact: true }).fill("1");
    await page.getByLabel("여유시간 (시간)", { exact: true }).fill("3");
    await page.getByLabel("여유시간 (분)", { exact: true }).fill("20");
    await page.getByRole("button", { name: "변경 사항 저장" }).click();
    await expect(page.getByLabel("저장된 마감일")).toContainText(
      "1일 3시간 20분 전",
    );
    await page.reload();
    await expect(page.getByLabel("여유시간 (일)", { exact: true })).toHaveValue(
      "1",
    );
    await expect(
      page.getByLabel("여유시간 (시간)", { exact: true }),
    ).toHaveValue("3");
    await expect(page.getByLabel("여유시간 (분)", { exact: true })).toHaveValue(
      "20",
    );
    const saved = await ownRequest(page, `/api/deadlines/${deadline.id}`);
    expect(saved.status).toBe(200);
    expect(new Date(saved.data.due_at).toISOString()).toBe(
      "2026-10-05T09:00:00.000Z",
    );
    expect(saved.data.safety_buffer_minutes).toBe(1640);
    expect(new Date(saved.data.safe_due_at).toISOString()).toBe(
      "2026-10-04T05:40:00.000Z",
    );
    for (const body of [
      { safety_buffer_minutes: -1 },
      { safety_buffer_minutes: 2147483648 },
      { safe_due_at: "2026-10-04T05:40:00Z" },
      { due_at: "0001-01-01T00:00:00Z" },
    ]) {
      expect(
        (await ownRequest(page, `/api/deadlines/${deadline.id}`, "PATCH", body))
          .status,
      ).toBe(422);
    }
    const unchanged = await ownRequest(page, `/api/deadlines/${deadline.id}`);
    expect(unchanged.data.due_at).toBe(saved.data.due_at);
    expect(unchanged.data.safety_buffer_minutes).toBe(1640);
    await page.getByLabel("마감 일시 (한국 시간)").fill("2026-10-06T18:00");
    await page.getByRole("button", { name: "변경 사항 저장" }).click();
    await expect(
      page.getByLabel("저장된 마감일").locator("time").nth(1),
    ).toHaveAttribute("datetime", /2026-10-05T05:40:00(?:Z|\+00:00)$/);
    await page.goto("/deadlines");
    await expect(
      page.getByRole("link").filter({ hasText: marker }),
    ).toContainText("안전 마감");
    await page.getByRole("link").filter({ hasText: marker }).click();
    await page.getByLabel("안전 마감일 사용", { exact: true }).uncheck();
    await page.getByRole("button", { name: "변경 사항 저장" }).click();
    await expect(page.getByLabel("저장된 마감일")).toContainText("미설정");
    await page.reload();
    await expect(
      page.getByLabel("안전 마감일 사용", { exact: true }),
    ).not.toBeChecked();
    const disabled = await ownRequest(page, `/api/deadlines/${deadline.id}`);
    expect(disabled.data.safety_buffer_minutes).toBeNull();
    expect(disabled.data.safe_due_at).toBeNull();
    expect(new Date(disabled.data.due_at).toISOString()).toBe(
      "2026-10-06T09:00:00.000Z",
    );
    expect((await ownRequest(page, "/api/tasks")).data).toHaveLength(0);
    expect((await ownRequest(page, "/api/scheduled-events")).data).toHaveLength(
      0,
    );
  } finally {
    const failures: number[] = [];
    for (const id of ids) {
      const deleted = await ownRequest(page, `/api/deadlines/${id}`, "DELETE");
      if (![204, 404].includes(deleted.status)) failures.push(deleted.status);
      const missing = await ownRequest(page, `/api/deadlines/${id}`);
      if (missing.status !== 404) failures.push(missing.status);
    }
    expect(failures, "Only this run's test deadlines are removed").toEqual([]);
  }
});
