import { test, expect, type Page } from "@playwright/test";
import { login, mockApi } from "./fixtures";
import { aiSource, readyAnalysis } from "./analysis-fixtures";
import type { Source } from "../types/api";

async function workflow(page: Page, text = false) {
  await mockApi(page);
  let source: Source = {
    ...aiSource,
    id: "saved-source",
    source_type: text ? "text" : "url",
    original_url: text ? null : "https://example.com/notice",
    processing_status: "pending",
    extracted_text: null,
    extracted_text_hash: null,
  };
  let result: typeof readyAnalysis | null = null;
  const state = {
    creates: 0,
    extracts: 0,
    analyses: 0,
    failExtraction: false,
    lostAnalysis: false,
  };
  await page.route("**/test-api/api/sources", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    state.creates++;
    source = { ...source, ...route.request().postDataJSON() };
    return route.fulfill({ status: 201, json: source });
  });
  await page.route("**/test-api/api/sources/saved-source**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/analyze")) {
      state.extracts++;
      if (state.failExtraction)
        return route.fulfill({
          status: 503,
          json: { detail: "fetch_timeout" },
        });
      source = {
        ...source,
        processing_status: "extracted",
        extracted_text: aiSource.extracted_text,
        extracted_text_hash: "a".repeat(64),
      };
      return route.fulfill({ status: 202, json: source });
    }
    if (path.endsWith("/ai-analyses")) {
      if (route.request().method() === "GET")
        return route.fulfill({ json: result ? [result] : [] });
      expect(route.request().postDataJSON()).toEqual({
        allow_external_ai: text,
        input_hash: "a".repeat(64),
        reuse_existing: true,
      });
      state.analyses++;
      result = {
        ...readyAnalysis,
        source_id: source.id,
        input_text: source.extracted_text!,
        model: text ? "test-synthetic" : "html:url:v1",
        candidates: readyAnalysis.candidates.map((item) => ({
          ...item,
          title: source.title || item.title,
        })),
      };
      return route.fulfill(
        state.lostAnalysis
          ? { status: 502, json: { detail: "[테스트] 응답 유실" } }
          : { status: 202, json: result },
      );
    }
    return route.fulfill({ json: source });
  });
  await page.route("**/test-api/api/ai-analyses/analysis-1", (route) =>
    route.fulfill({ json: result }),
  );
  return {
    state,
    changeText: () => {
      source = {
        ...source,
        extracted_text: "변경된 원문",
        extracted_text_hash: "b".repeat(64),
      };
    },
  };
}

test("saving a URL proceeds to HTML review without detail clicks or AI transmission", async ({
  page,
}) => {
  const { state } = await workflow(page);
  await login(page);
  await page.goto("/sources/new");
  await page
    .getByLabel("일정 제목 (선택)", { exact: true })
    .fill("내가 입력한 일정 제목");
  await page
    .getByLabel("원본 URL", { exact: true })
    .fill("https://example.com/notice");
  await page.getByRole("button", { name: "자료 저장", exact: true }).click();
  await expect(page).toHaveURL(/\/analyses\/analysis-1$/);
  await expect(
    page.getByRole("heading", { name: "마감일 검토", exact: true }),
  ).toBeVisible();
  expect(state).toMatchObject({ creates: 1, extracts: 1, analyses: 1 });
  await expect(page.getByLabel("후보 1 제목", { exact: true })).toHaveValue(
    "내가 입력한 일정 제목",
  );
});

test("text consent is required once before external analysis; reload reuses result", async ({
  page,
}) => {
  const { state } = await workflow(page, true);
  await login(page);
  await page.goto("/sources/new");
  await page
    .getByLabel("원본 텍스트", { exact: true })
    .fill(aiSource.original_text!);
  await page.getByRole("button", { name: "자료 저장", exact: true }).click();
  await expect(page).toHaveURL(/\/sources\/saved-source\/review$/);
  const button = page.getByRole("button", { name: "동의하고 AI 검토 시작" });
  await expect(button).toBeDisabled();
  expect(state.analyses).toBe(0);
  await page.getByRole("checkbox").check();
  await button.click();
  await expect(page).toHaveURL(/\/analyses\/analysis-1$/);
  await page.goto("/sources/saved-source/review");
  await expect(page).toHaveURL(/\/analyses\/analysis-1$/);
  expect(state).toMatchObject({ creates: 1, extracts: 1, analyses: 1 });
});

test("extraction retry keeps the saved source and lost analysis reply reuses history", async ({
  page,
}) => {
  const { state } = await workflow(page);
  state.failExtraction = true;
  await login(page);
  await page.goto("/sources/new");
  await page
    .getByLabel("원본 URL", { exact: true })
    .fill("https://example.com/notice");
  await page.getByRole("button", { name: "자료 저장", exact: true }).click();
  const alert = page
    .getByRole("region", { name: "등록한 자료 검토" })
    .getByRole("alert");
  await expect(alert).toContainText("응답 대기 시간");
  expect(state.creates).toBe(1);
  state.failExtraction = false;
  state.lostAnalysis = true;
  await page.getByRole("button", { name: "진행 상태 확인·다시 시도" }).click();
  await expect(alert).toBeVisible();
  await page.getByRole("button", { name: "진행 상태 확인·다시 시도" }).click();
  await expect(page).toHaveURL(/\/analyses\/analysis-1$/);
  expect(state.creates).toBe(1);
  expect(state.analyses).toBe(1);
});

test("changed text requires fresh consent and leaving the page prevents later starts", async ({
  page,
}) => {
  const { state, changeText } = await workflow(page, true);
  await login(page);
  await page.goto("/sources/saved-source/review");
  const button = page.getByRole("button", { name: "동의하고 AI 검토 시작" });
  await expect(button).toBeDisabled();
  await page.getByRole("checkbox").check();
  changeText();
  await button.click();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  expect(state.analyses).toBe(0);
  await page.getByRole("link", { name: "← 원본 자료 목록" }).click();
  await expect(page).toHaveURL(/\/sources$/);
  expect(state.analyses).toBe(0);
});

test("leaving during history lookup cannot launch an analysis or redirect a new form", async ({
  page,
}) => {
  const { state } = await workflow(page);
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let began!: () => void;
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  await page.route(
    "**/test-api/api/sources/saved-source/ai-analyses?**",
    async (route) => {
      began();
      await waiting;
      await route.fulfill({ json: [] });
    },
  );
  await login(page);
  await page.goto("/sources/saved-source/review");
  await started;
  await page
    .getByRole("link", { name: "새 일정 등록하기", exact: true })
    .click();
  await expect(page).toHaveURL(/\/sources\/new\?new=/);
  const fresh = page.url();
  release();
  await page.getByLabel("일정 제목 (선택)").fill("새 자료 입력");
  await expect(page).toHaveURL(fresh);
  expect(state.analyses).toBe(0);
});
