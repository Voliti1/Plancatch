import { test, expect } from "@playwright/test";
import { login } from "./fixtures";
import { aiSource, mockAnalyses, readyAnalysis } from "./analysis-fixtures";
import type { Analysis } from "../types/analysis";

const raw = "2026.11.25 ~11/25(수)";
const evidence = `마감일 원문: ${raw}`;
const source = {
  ...aiSource,
  title: "[테스트] 잡플래닛 채용공고",
  source_type: "url" as const,
  original_url:
    "https://www.jobplanet.co.kr/job/search?posting_ids%5B%5D=1776386",
  original_text: null,
  extracted_text: `(주)테스트기업\n${evidence}`,
};
const review: Analysis = {
  ...readyAnalysis,
  model: "html:url:v1",
  input_text: source.extracted_text,
  warnings: ["잡플래닛 원문에는 마감 날짜만 있고 마감 시각이 없습니다."],
  candidates: [
    {
      ...readyAnalysis.candidates[0],
      title: source.title,
      due_at: null,
      selected: false,
      description: null,
      evidence_text: evidence,
    },
  ],
  date_choices: [
    {
      id: "jp-date",
      raw_text: "2026.11.25",
      date: "2026-11-25",
      due_at: null,
      evidence_text: evidence,
    },
  ],
  source_period: {
    site: "jobplanet",
    start_text: null,
    end_text: raw,
    deadline_at: null,
    remaining_text: null,
    has_conflict: false,
  },
};

test("JobPlanet date-only HTML requires a user time before saving and approving", async ({
  page,
}) => {
  const state = await mockAnalyses(page, [review], source);
  await login(page);
  await page.clock.install({ time: new Date("2026-10-27T05:00:00Z") });
  await page.goto("/analyses/analysis-1");
  const region = page.getByRole("region", {
    name: "잡플래닛 접수기간",
    exact: true,
  });
  await expect(region).toContainText(raw);
  await expect(region).toContainText("마감일 미확정");
  await expect(
    page.getByText("원문 마감 날짜는 2026-11-25입니다.", { exact: false }),
  ).toBeVisible();
  await expect(page.locator(".candidate-evidence")).toContainText(raw);
  await expect(page.locator(".candidate-evidence")).not.toContainText("신뢰도");
  const dateInput = page.getByLabel("후보 1 마감일 (한국 시간)", {
    exact: true,
  });
  await expect(dateInput).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "선택한 0개 승인", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "2026.11.25 · 일시 입력 필요", exact: true })
    .click();
  await expect(dateInput).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "선택한 1개 승인", exact: true }),
  ).toBeDisabled();
  expect(state.deadlines).toHaveLength(0);
  expect(state.starts).toBe(0);
  await dateInput.fill("2026-11-25T18:00");
  await page
    .getByRole("button", { name: "검토 내용 저장", exact: true })
    .click();
  const approve = page.getByRole("button", {
    name: "선택한 1개 승인",
    exact: true,
  });
  await expect(approve).toBeEnabled();
  expect(state.analyses[0].candidates[0].due_at).toBe(
    "2026-11-25T09:00:00.000Z",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: test.info().outputPath("jobplanet-period.png"),
    fullPage: true,
  });
  await approve.click();
  await expect(
    page.getByRole("heading", { name: "마감일 등록 완료", exact: true }),
  ).toBeVisible();
  expect(state.deadlines).toHaveLength(1);
  expect(state.deadlines[0].due_at).toBe("2026-11-25T09:00:00.000Z");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "마감일 등록 완료", exact: true }),
  ).toBeVisible();
  expect(state.deadlines).toHaveLength(1);
  expect(state.starts).toBe(0);
});

test("JobPlanet conflicting date remains empty and cannot be approved", async ({
  page,
}) => {
  await mockAnalyses(
    page,
    [
      {
        ...review,
        warnings: ["잡플래닛 마감 날짜와 요일이 일치하지 않습니다."],
        source_period: { ...review.source_period!, has_conflict: true },
      },
    ],
    source,
  );
  await login(page);
  await page.goto("/analyses/analysis-1");
  await expect(
    page.getByRole("region", { name: "잡플래닛 접수기간" }),
  ).toContainText("충돌");
  await expect(
    page.getByLabel("후보 1 마감일 (한국 시간)", { exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "선택한 0개 승인", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("원문 마감 날짜는 2026-11-25입니다.", { exact: false }),
  ).toHaveCount(0);
});

test("a blocked JobPlanet source shows access guidance and starts no analysis", async ({
  page,
}) => {
  const state = await mockAnalyses(page, [], {
    ...source,
    processing_status: "failed",
    error_message: "access_denied",
    extracted_text: null,
  });
  await login(page);
  await page.goto("/sources/ai-source");
  await expect(
    page.getByText("사이트에서 접근을 차단했습니다.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "HTML 마감일 확인", exact: true }),
  ).toBeDisabled();
  expect(state.starts).toBe(0);
  expect(state.analyses).toHaveLength(0);
  expect(state.deadlines).toHaveLength(0);
});
