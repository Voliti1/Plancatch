import { test, expect } from "@playwright/test";
import { login } from "./fixtures";
import { aiSource, mockAnalyses, readyAnalysis } from "./analysis-fixtures";

test("consent, analysis polling, full candidate save and selected approval persist", async ({
  page,
}) => {
  const state = await mockAnalyses(page, []);
  state.finish = false;
  await login(page);
  await page.clock.install();
  await page.goto("/sources/ai-source");
  const start = page.getByRole("button", { name: "AI 분석 시작", exact: true });
  await expect(start).toBeDisabled();
  expect(state.starts).toBe(0);
  await page
    .getByRole("checkbox", {
      name: "이 자료의 추출 원문 전체를 Google Gemini에 전송하여 분석하는 데 동의합니다.",
      exact: true,
    })
    .check();
  await start.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(page).toHaveURL(/\/analyses\/analysis-1$/);
  await expect(page.getByText("AI 분석 중", { exact: true })).toBeVisible();
  state.finish = true;
  await page.clock.fastForward(2001);
  await expect(page.getByText("검토 대기", { exact: true })).toBeVisible();
  const finishedReads = state.reads;
  await page.clock.fastForward(10000);
  expect(state.reads).toBe(finishedReads);
  expect(state.starts).toBe(1);
  await expect(
    page.getByRole("region", { name: "분석 주의사항" }),
  ).toContainText("발표 날짜");
  await page
    .getByLabel("후보 1 제목", { exact: true })
    .fill("[테스트] 보고서 수정");
  await page
    .getByRole("checkbox", { name: "후보 1 포함", exact: true })
    .uncheck();
  await page
    .getByRole("checkbox", { name: "후보 2 포함", exact: true })
    .check();
  await page
    .getByLabel("후보 2 마감일 (한국 시간)", { exact: true })
    .fill("2026-10-03T18:00");
  await expect(
    page.getByRole("button", { name: "선택한 1개 승인", exact: true }),
  ).toBeDisabled();
  const save = page.waitForRequest((request) => request.method() === "PATCH");
  await page
    .getByRole("button", { name: "검토 내용 저장", exact: true })
    .click();
  const payload = (await save).postDataJSON();
  expect(payload.revision).toBe(1);
  expect(payload.candidates).toHaveLength(2);
  expect(payload.candidates[0].due_at).toBe(readyAnalysis.candidates[0].due_at);
  expect(payload.candidates[0].selected).toBe(false);
  expect(payload.candidates[1].due_at).toBe("2026-10-03T09:00:00.000Z");
  await expect(
    page.getByText("검토 내용을 저장했습니다.", { exact: true }),
  ).toBeVisible();
  expect(state.deadlines).toHaveLength(0);
  await page.screenshot({
    path: test.info().outputPath("ai-review.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  const approval = page.waitForRequest((request) =>
    request.url().endsWith("/approve"),
  );
  await page
    .getByRole("button", { name: "선택한 1개 승인", exact: true })
    .click();
  expect((await approval).postDataJSON()).toEqual({ revision: 2 });
  await expect(
    page.getByRole("heading", { name: "마감일 등록 완료", exact: true }),
  ).toBeVisible();
  expect(state.deadlines).toHaveLength(1);
  expect(state.deadlines[0].title).toBe("[테스트] 발표");
  await page.reload();
  await expect(page.getByText("승인 완료", { exact: true })).toBeVisible();
  expect(state.deadlines).toHaveLength(1);
  await page
    .getByRole("link", { name: "생성된 마감일 1 보기 →", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "[테스트] 발표", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "[테스트] 발표", exact: true }),
  ).toBeVisible();
});

test("save failure and revision conflict preserve input until explicit reload", async ({
  page,
}) => {
  const state = await mockAnalyses(page);
  await login(page);
  await page.goto("/analyses/analysis-1");
  await page
    .getByLabel("후보 1 제목", { exact: true })
    .fill("[테스트] 유지할 입력");
  await page.route("**/test-api/api/ai-analyses/analysis-1", (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({ status: 500, json: { detail: "테스트 저장 실패" } })
      : route.fallback(),
  );
  await page
    .getByRole("button", { name: "검토 내용 저장", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "테스트 저장 실패" }),
  ).toBeVisible();
  await expect(page.getByLabel("후보 1 제목", { exact: true })).toHaveValue(
    "[테스트] 유지할 입력",
  );
  await page.unroute("**/test-api/api/ai-analyses/analysis-1");
  state.analyses[0].revision = 2;
  state.analyses[0].candidates[0].title = "[테스트] 서버 최신 제목";
  await page
    .getByRole("button", { name: "검토 내용 저장", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "버전이 바뀌었습니다" }),
  ).toBeVisible();
  await expect(page.getByLabel("후보 1 제목", { exact: true })).toHaveValue(
    "[테스트] 유지할 입력",
  );
  await page
    .getByRole("button", { name: "최신 결과 불러오기", exact: true })
    .click();
  await page.getByRole("button", { name: "계속 수정", exact: true }).click();
  await expect(page.getByLabel("후보 1 제목", { exact: true })).toHaveValue(
    "[테스트] 유지할 입력",
  );
  await page
    .getByRole("button", { name: "최신 결과 불러오기", exact: true })
    .click();
  await page
    .getByRole("button", { name: "입력을 버리고 불러오기", exact: true })
    .click();
  await expect(page.getByLabel("후보 1 제목", { exact: true })).toHaveValue(
    "[테스트] 서버 최신 제목",
  );
  await expect(page.getByText("최신 결과를 불러왔습니다.")).toBeVisible();
});

test("changed source blocks approval and leaves result visible", async ({
  page,
}) => {
  const state = await mockAnalyses(page);
  state.sourceChanged = true;
  await login(page);
  await page.goto("/analyses/analysis-1");
  await page
    .getByRole("button", { name: "선택한 1개 승인", exact: true })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "원문이 변경되어 승인할 수 없습니다" }),
  ).toBeVisible();
  await expect(page.getByLabel("후보 1 제목", { exact: true })).toHaveValue(
    readyAnalysis.candidates[0].title,
  );
  expect(state.deadlines).toHaveLength(0);
});

test("empty result and ambiguous date can be rejected without creating deadlines", async ({
  page,
}) => {
  const empty = { ...readyAnalysis, candidates: [] };
  const state = await mockAnalyses(page, [empty]);
  await login(page);
  await page.goto("/analyses/analysis-1");
  await expect(
    page.getByText("마감일 후보가 없습니다. 원문과 주의사항을 확인해 주세요."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "선택한 0개 승인", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "전체 거부", exact: true }).click();
  await page.getByRole("button", { name: "거부 취소", exact: true }).click();
  expect(state.analyses[0].status).toBe("ready");
  const reject = page.waitForRequest((request) =>
    request.url().endsWith("/reject"),
  );
  await page.getByRole("button", { name: "전체 거부", exact: true }).click();
  await page
    .getByRole("button", { name: "전체 거부 확인", exact: true })
    .click();
  expect((await reject).postDataJSON()).toEqual({ revision: 1 });
  await expect(
    page.getByText(
      "분석 결과를 전체 거부했습니다. 이 분석으로 생성된 마감일은 없습니다.",
    ),
  ).toBeVisible();
  expect(state.deadlines).toHaveLength(0);
  await page.reload();
  await expect(page.getByText("전체 거부", { exact: true })).toBeVisible();
});

test("capacity and missing AI configuration do not clear consent or invent results", async ({
  page,
}) => {
  const state = await mockAnalyses(page, []);
  await login(page);
  await page.goto("/sources/ai-source");
  await page.getByRole("checkbox", { name: /Google Gemini/ }).check();
  await page.route("**/test-api/api/sources/ai-source/ai-analyses", (route) =>
    route.fulfill({ status: 503, json: { detail: "ai_not_configured" } }),
  );
  await page.getByRole("button", { name: "AI 분석 시작", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "AI 설정이 준비되지 않아" }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: /Google Gemini/ }),
  ).toBeChecked();
  await page.unroute("**/test-api/api/sources/ai-source/ai-analyses");
  await page.route("**/test-api/api/sources/ai-source/ai-analyses", (route) =>
    route.fulfill({
      status: 429,
      json: { detail: "AI capacity reached; retry later" },
    }),
  );
  await page.getByRole("button", { name: "AI 분석 시작", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "처리 용량" }),
  ).toBeVisible();
  expect(state.starts).toBe(0);
});

test("oversized input is blocked and changed extraction requires fresh consent", async ({
  page,
}) => {
  await mockAnalyses(page, [], {
    ...aiSource,
    extracted_text: "가".repeat(40001),
  });
  await login(page);
  await page.goto("/sources/ai-source");
  await expect(
    page.getByRole("alert").filter({ hasText: "40,000자를 초과" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "AI 분석 시작", exact: true }),
  ).toBeDisabled();
  await page.route("**/test-api/api/sources/ai-source", (route) =>
    route.fulfill({ json: aiSource }),
  );
  await page.reload();
  await page.getByRole("checkbox", { name: /Google Gemini/ }).check();
  await page.route("**/test-api/api/sources/ai-source/analyze", (route) =>
    route.fulfill({
      status: 202,
      json: {
        ...aiSource,
        processing_status: "processing",
        extracted_text: null,
      },
    }),
  );
  await page.route("**/test-api/api/sources/ai-source", (route) =>
    route.fulfill({
      json: { ...aiSource, extracted_text: "[테스트] 새로 추출한 원문입니다." },
    }),
  );
  await page
    .getByRole("button", { name: "원문 다시 추출", exact: true })
    .click();
  await expect(page.locator(".source-content-dialog .source-text")).toHaveText(
    "[테스트] 새로 추출한 원문입니다.",
  );
  await page.getByRole("button", { name: "자세히 보기", exact: true }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("[테스트] 새로 추출한 원문입니다.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "자세히 보기 닫기" }).click();
  await expect(
    page.getByRole("checkbox", { name: /Google Gemini/ }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "AI 분석 시작", exact: true }),
  ).toBeDisabled();
});

test("AI polling stops on timeout, terminal failure and page exit", async ({
  page,
}) => {
  const state = await mockAnalyses(page, [
    { ...readyAnalysis, status: "processing", candidates: [] },
  ]);
  state.finish = false;
  await login(page);
  await page.clock.install();
  await page.goto("/analyses/analysis-1");
  await expect(page.getByText("AI 분석 중", { exact: true })).toBeVisible();
  await page.clock.fastForward(91000);
  await expect(
    page.getByRole("alert").filter({ hasText: "자동 조회를 중단했습니다" }),
  ).toBeVisible();
  const stopped = state.reads;
  await page.clock.fastForward(10000);
  expect(state.reads).toBe(stopped);
  state.analyses[0].status = "failed";
  state.analyses[0].error_message = "ai_invalid_result";
  await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  await page.clock.fastForward(2001);
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "AI 결과를 검증하지 못했습니다" }),
  ).toBeVisible();
  const failed = state.reads;
  await page.clock.fastForward(10000);
  expect(state.reads).toBe(failed);
  state.analyses[0].status = "processing";
  await page.reload();
  await expect(page.getByText("AI 분석 중", { exact: true })).toBeVisible();
  await page
    .getByRole("link", { name: "← 원본 자료 상세", exact: true })
    .click();
  await expect(page).toHaveURL(/\/sources\/ai-source$/);
  const exited = state.reads;
  await page.clock.fastForward(10000);
  expect(state.reads).toBe(exited);
});

test("analysis missing record and login expiration follow existing protection", async ({
  page,
}) => {
  await mockAnalyses(page);
  await page.goto("/analyses/analysis-1");
  await expect(page).toHaveURL(/\/login$/);
  await login(page);
  await page.goto("/analyses/missing");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "자료 또는 분석을 찾을 수 없습니다" }),
  ).toBeVisible();
  await page.route("**/test-api/api/ai-analyses/analysis-1", (route) =>
    route.fulfill({ status: 401, json: { detail: "Unauthorized" } }),
  );
  await page.goto("/analyses/analysis-1");
  await expect(page).toHaveURL(/\/login$/);
  expect(
    await page.evaluate(() => sessionStorage.getItem("plancatch.access_token")),
  ).toBeNull();
});

test("history pagination and approved results stay read-only", async ({
  page,
}) => {
  const history = Array.from({ length: 11 }, (_, index) => ({
    ...readyAnalysis,
    id: `history-${index}`,
    status: "approved" as const,
    created_at: `2026-09-${String(30 - index).padStart(2, "0")}T00:00:00Z`,
    approved_deadline_ids: [`deadline-history-${index}`],
  }));
  await mockAnalyses(page, history);
  await login(page);
  await page.goto("/sources/ai-source");
  await page.getByRole("button", { name: "다음 기록", exact: true }).click();
  await expect(
    page.getByRole("link", {
      name: "2026. 9. 20. 오전 9:00 · 승인 완료 →",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("link", {
      name: "2026. 9. 20. 오전 9:00 · 승인 완료 →",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/\/analyses\/history-10$/);
  await expect(
    page.getByRole("button", { name: /승인|전체 거부|검토 내용 저장/ }),
  ).toHaveCount(0);
  await expect(page.getByLabel("후보 1 제목", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "생성된 마감일 1 보기 →", exact: true }),
  ).toBeVisible();
});

test("missing dates, blank titles and 422 validation keep review input", async ({
  page,
}) => {
  const state = await mockAnalyses(page);
  await login(page);
  await page.goto("/analyses/analysis-1");
  await page
    .getByRole("checkbox", { name: "후보 2 포함", exact: true })
    .check();
  await expect(
    page.getByRole("button", { name: "선택한 2개 승인", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("후보 1 제목", { exact: true }).fill("   ");
  await page
    .getByRole("button", { name: "검토 내용 저장", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "모든 후보의 제목" }),
  ).toBeVisible();
  expect(state.analyses[0].revision).toBe(1);
  await page
    .getByLabel("후보 1 제목", { exact: true })
    .fill("[테스트] 검증할 제목");
  await page.route("**/test-api/api/ai-analyses/analysis-1", (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({
          status: 422,
          json: { detail: "Invalid candidate input" },
        })
      : route.fallback(),
  );
  await page
    .getByRole("button", { name: "검토 내용 저장", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "입력값을 확인해 주세요" }),
  ).toBeVisible();
  await expect(page.getByLabel("후보 1 제목", { exact: true })).toHaveValue(
    "[테스트] 검증할 제목",
  );
  await expect(
    page.getByRole("checkbox", { name: "후보 2 포함", exact: true }),
  ).toBeChecked();
  expect(state.deadlines).toHaveLength(0);
});
