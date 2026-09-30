import { randomBytes } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import type { Analysis } from "../types/analysis";

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
  // The existing authenticated browser owns these resources. Never return/log its token.
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

test("live test account: URL/text extraction, AI review, approval persistence and duplicate protection", async ({
  page,
}) => {
  const marker = `[테스트] Codex AI ${randomBytes(5).toString("hex")}`;
  const email = `plancatch-test-${randomBytes(8).toString("hex")}@example.com`;
  const password = randomBytes(24).toString("base64url");
  const sources: string[] = [];
  const deadlines: string[] = [];
  await page.route("**/test-api/api/**", async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({
      url: `${upstream}${url.pathname.replace("/test-api", "")}${url.search}`,
    });
    await route.fulfill({ response });
  });
  await page.goto("/signup");
  await page.getByLabel("이름 (선택)").fill("전용 통합 테스트");
  await page.getByLabel("이메일", { exact: true }).fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByLabel("비밀번호 확인", { exact: true }).fill(password);
  await page.getByRole("button", { name: "계정 만들기 →", exact: true }).click();
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
  console.info("Live verification: dedicated test account signed in");
  async function createSource(
    type: "url" | "text",
    content: string,
    title: string,
  ) {
    await page.goto("/sources/new");
    await page
      .getByRole("button", {
        name: type === "text" ? "텍스트" : "URL 링크",
        exact: true,
      })
      .click();
    await page.getByLabel("자료 제목 (선택)").fill(title);
    await page
      .getByLabel(type === "text" ? "원본 텍스트" : "원본 URL")
      .fill(content);
    const created = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/api/sources"),
    );
    await page.getByRole("button", { name: "자료 저장", exact: true }).click();
    const response = await created;
    expect(response.status()).toBe(201);
    const { id } = await response.json();
    sources.push(id);
    await expect(page).toHaveURL(/\/sources$/);
    await page.goto(`/sources/${id}`);
    await page.getByRole("button", { name: "원문 추출", exact: true }).click();
    return id as string;
  }
  try {
    await createSource("url", "https://example.com", `${marker} 공개 URL`);
    await expect(page.getByText("원문 추출 완료", { exact: true })).toBeVisible(
      { timeout: 95000 },
    );
    await createSource("url", "http://127.0.0.1", `${marker} 접근 제한`);
    await expect(page.getByText("처리 실패", { exact: true })).toBeVisible({
      timeout: 95000,
    });
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "보안 정책상 접근할 수 없는 URL" }),
    ).toBeVisible();
    const sourceId = await createSource(
      "text",
      "이것은 PlanCatch 전용 통합 테스트 자료입니다. 실제 업무가 아닙니다. 테스트 보고서 제출의 마감은 2026년 10월 15일 오후 6시이며, 시간대는 Asia/Seoul (UTC+09:00)입니다.",
      `${marker} 분석 자료`,
    );
    await expect(page.getByText("원문 추출 완료", { exact: true })).toBeVisible(
      { timeout: 95000 },
    );
    await expect(
      page.getByRole("button", { name: "AI 분석 시작", exact: true }),
    ).toBeDisabled();
    await page.getByRole("checkbox", { name: /Google Gemini/ }).check();
    await page
      .getByRole("button", { name: "AI 분석 시작", exact: true })
      .click();
    await expect(page).toHaveURL(/\/analyses\/[\w-]+$/);
    const analysisId = new URL(page.url()).pathname.split("/").at(-1)!;
    await expect(page.getByText("검토 대기", { exact: true })).toBeVisible({
      timeout: 95000,
    });
    const loaded = await ownRequest(page, `/api/ai-analyses/${analysisId}`);
    expect(loaded.status).toBe(200);
    const analysis = loaded.data as Analysis;
    expect(analysis.candidates.length).toBeGreaterThan(0);
    for (let index = 0; index < analysis.candidates.length; index++) {
      const checkbox = page.getByRole("checkbox", {
        name: `후보 ${index + 1} 포함`,
        exact: true,
      });
      if (index === 0) await checkbox.check();
      else await checkbox.uncheck();
    }
    await page
      .getByLabel("후보 1 제목", { exact: true })
      .fill(`${marker} 수정한 마감일`);
    await page
      .getByLabel("후보 1 마감일 (한국 시간)", { exact: true })
      .fill("2026-10-15T18:00");
    await page
      .getByRole("button", { name: "검토 내용 저장", exact: true })
      .click();
    await expect(
      page.getByText("검토 내용을 저장했습니다.", { exact: true }),
    ).toBeVisible();
    const approved = page.waitForResponse((response) =>
      response.url().endsWith(`/${analysisId}/approve`),
    );
    await page
      .getByRole("button", { name: "선택한 1개 승인", exact: true })
      .click();
    const approval = (await (await approved).json()) as Analysis;
    deadlines.push(...approval.approved_deadline_ids);
    await expect(
      page.getByRole("heading", { name: "마감일 등록 완료", exact: true }),
    ).toBeVisible();
    expect(deadlines).toHaveLength(1);
    const duplicate = await ownRequest(
      page,
      `/api/ai-analyses/${analysisId}/approve`,
      "POST",
      { revision: approval.revision },
    );
    expect(duplicate.status).toBe(200);
    expect(duplicate.data.approved_deadline_ids).toEqual(deadlines);
    await page.reload();
    await expect(page.getByText("승인 완료", { exact: true })).toBeVisible();
    await page
      .getByRole("link", { name: "생성된 마감일 1 보기 →", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: `${marker} 수정한 마감일`,
        exact: true,
      }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", {
        name: `${marker} 수정한 마감일`,
        exact: true,
      }),
    ).toBeVisible();
    const saved = await ownRequest(page, `/api/deadlines/${deadlines[0]}`);
    expect(saved.status).toBe(200);
    expect(saved.data.source_id).toBe(sourceId);
    expect(new Date(saved.data.due_at).toISOString()).toBe(
      "2026-10-15T09:00:00.000Z",
    );
    const list = await ownRequest(page, "/api/deadlines");
    expect(list.data).toHaveLength(1);
    const tasks = await ownRequest(page, "/api/tasks");
    expect(tasks.data).toHaveLength(0);
    const events = await ownRequest(page, "/api/scheduled-events");
    expect(events.data).toHaveLength(0);
  } finally {
    const cleanupFailures: number[] = [];
    for (const id of deadlines) {
      const response = await ownRequest(page, `/api/deadlines/${id}`, "DELETE");
      if (![204, 404].includes(response.status))
        cleanupFailures.push(response.status);
    }
    for (const id of sources) {
      const response = await ownRequest(page, `/api/sources/${id}`, "DELETE");
      if (![204, 404].includes(response.status))
        cleanupFailures.push(response.status);
    }
    expect(
      cleanupFailures,
      "Only newly created test sources/deadlines are removed",
    ).toEqual([]);
  }
});
