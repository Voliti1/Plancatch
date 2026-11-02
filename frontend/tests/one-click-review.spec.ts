import { test, expect } from "@playwright/test";
import { login } from "./fixtures";
import { mockAnalyses } from "./analysis-fixtures";

const register = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: "선택한 1개 일정 등록", exact: true });
test("one click saves every edit before approving the returned revision, double clicks are locked", async ({
  page,
}) => {
  const state = await mockAnalyses(page);
  await login(page);
  await page.goto("/analyses/analysis-1");
  await page.getByLabel("후보 1 제목", { exact: true }).fill("한 번에 등록");
  const requests: { method: string; body: unknown }[] = [];
  page.on("request", (request) => {
    if (
      request.url().includes("/api/ai-analyses/") &&
      request.method() !== "GET"
    )
      requests.push({ method: request.method(), body: request.postDataJSON() });
  });
  await register(page).evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(
    page.getByRole("heading", { name: "마감일 등록 완료", exact: true }),
  ).toBeVisible();
  expect(requests.map((r) => r.method)).toEqual(["PATCH", "POST"]);
  expect(requests[1].body).toEqual({ revision: 2 });
  expect(state.deadlines).toHaveLength(1);
  expect(state.deadlines[0].title).toBe("한 번에 등록");
  expect(state.deadlines[0].due_at).toBe("2026-10-01T00:00:45.123Z");
});
test("save failure never approves and retains inputs for a one click retry", async ({
  page,
}) => {
  const state = await mockAnalyses(page);
  await login(page);
  await page.goto("/analyses/analysis-1");
  await page
    .getByLabel("후보 1 제목", { exact: true })
    .fill("저장 실패 후 유지");
  let failed = true,
    approvals = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/approve")) approvals++;
  });
  await page.route("**/test-api/api/ai-analyses/analysis-1", (route) =>
    route.request().method() === "PATCH" && failed
      ? route.fulfill({ status: 500, json: { detail: "저장 검사 실패" } })
      : route.fallback(),
  );
  await register(page).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("저장 검사 실패");
  expect(approvals).toBe(0);
  expect(state.deadlines).toHaveLength(0);
  await expect(page.getByLabel("후보 1 제목", { exact: true })).toHaveValue(
    "저장 실패 후 유지",
  );
  failed = false;
  await register(page).click();
  await expect(
    page.getByRole("heading", { name: "마감일 등록 완료", exact: true }),
  ).toBeVisible();
  expect(approvals).toBe(1);
});
test("failed approval keeps acknowledged revision and retries without saving again", async ({
  page,
}) => {
  const state = await mockAnalyses(page);
  await login(page);
  await page.goto("/analyses/analysis-1");
  await page.getByLabel("후보 1 제목", { exact: true }).fill("승인 재시도");
  let failed = true,
    patches = 0;
  const revisions: number[] = [];
  page.on("request", (r) => {
    if (r.method() === "PATCH") patches++;
    if (r.url().endsWith("/approve")) revisions.push(r.postDataJSON().revision);
  });
  await page.route("**/test-api/api/ai-analyses/analysis-1/approve", (route) =>
    failed
      ? route.fulfill({ status: 500, json: { detail: "등록 검사 실패" } })
      : route.fallback(),
  );
  await register(page).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("등록 검사 실패");
  expect(patches).toBe(1);
  expect(state.deadlines).toHaveLength(0);
  await expect(page.getByLabel("후보 1 제목", { exact: true })).toHaveValue(
    "승인 재시도",
  );
  failed = false;
  await register(page).click();
  await expect(
    page.getByRole("heading", { name: "마감일 등록 완료", exact: true }),
  ).toBeVisible();
  expect(patches).toBe(1);
  expect(revisions).toEqual([2, 2]);
  expect(state.deadlines).toHaveLength(1);
});
test("untouched candidates skip save; lost approval response can retry without duplication", async ({
  page,
}) => {
  const state = await mockAnalyses(page);
  await login(page);
  await page.goto("/analyses/analysis-1");
  let lose = true,
    patches = 0;
  page.on("request", (r) => {
    if (r.method() === "PATCH") patches++;
  });
  await page.route(
    "**/test-api/api/ai-analyses/analysis-1/approve",
    async (route) => {
      if (lose) {
        lose = false;
        const analysis = state.analyses[0],
          candidate = analysis.candidates[0];
        analysis.status = "approved";
        analysis.approved_deadline_ids = ["lost-response-deadline"];
        state.deadlines.push({
          id: "lost-response-deadline",
          source_id: analysis.source_id,
          title: candidate.title,
          due_at: candidate.due_at!,
          description: candidate.description,
          confidence: candidate.confidence,
          evidence_text: candidate.evidence_text,
          is_confirmed: true,
          deadline_type: null,
          safe_due_at: null,
          safety_buffer_minutes: null,
          created_at: analysis.created_at,
          updated_at: analysis.updated_at,
        });
        await route.abort("failed");
      } else await route.fallback();
    },
  );
  await register(page).click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  expect(state.deadlines).toHaveLength(1);
  await register(page).click();
  await expect(
    page.getByRole("heading", { name: "마감일 등록 완료", exact: true }),
  ).toBeVisible();
  expect(state.deadlines).toHaveLength(1);
  expect(patches).toBe(0);
});
test("a changed revision blocks registration and preserves edited values", async ({
  page,
}) => {
  const state = await mockAnalyses(page);
  await login(page);
  await page.goto("/analyses/analysis-1");
  await page.getByLabel("후보 1 제목", { exact: true }).fill("충돌 시 유지");
  state.analyses[0].revision = 2;
  await register(page).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("버전이 바뀌었습니다");
  await expect(page.getByLabel("후보 1 제목", { exact: true })).toHaveValue(
    "충돌 시 유지",
  );
  expect(state.deadlines).toHaveLength(0);
});
test("leaving while edits save cancels the following approval", async ({
  page,
}) => {
  const state = await mockAnalyses(page);
  await login(page);
  await page.goto("/analyses/analysis-1");
  await page.getByLabel("후보 1 제목", { exact: true }).fill("이동한 화면");
  let release!: () => void;
  const wait = new Promise<void>((resolve) => (release = resolve));
  let started!: () => void;
  const saving = new Promise<void>((resolve) => (started = resolve));
  let approvals = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/approve")) approvals++;
  });
  await page.route("**/test-api/api/ai-analyses/analysis-1", async (route) => {
    if (route.request().method() === "PATCH") {
      started();
      await wait;
    }
    await route.fallback();
  });
  await register(page).click();
  await saving;
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "일정", exact: true })
    .click();
  release();
  await expect(page).toHaveURL(/\/deadlines$/);
  await page.waitForTimeout(150);
  expect(approvals).toBe(0);
  expect(state.deadlines).toHaveLength(0);
});
