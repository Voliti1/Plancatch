import { test, expect } from "@playwright/test";
import { login } from "./fixtures";
import { aiSource, mockAnalyses, readyAnalysis } from "./analysis-fixtures";
import type { Analysis } from "../types/analysis";

const start = "2026-10-26T18:00:00.000+09:00";
const end = "2026-11-07T23:50:00.000+09:00";
const due = "2026-11-07T23:50:00+09:00";
const evidence = `마감일 원문: ${end}`;
const source = {
  ...aiSource,
  title: "[테스트] 자소설닷컴 인사직무 채용",
  source_type: "url" as const,
  original_url: "https://jasoseol.com/recruit/106909",
  original_text: null,
  extracted_text: `(주)테스트기업\n${evidence}`,
};
const review: Analysis = {
  ...readyAnalysis,
  model: "html:url:v1",
  input_text: source.extracted_text,
  warnings: [],
  candidates: [
    {
      ...readyAnalysis.candidates[0],
      title: source.title,
      due_at: due,
      description: "지원서 제출",
      evidence_text: evidence,
    },
  ],
  date_choices: [
    {
      id: "jaso-date",
      raw_text: end,
      date: "2026-11-07",
      due_at: due,
      evidence_text: evidence,
    },
  ],
  source_period: {
    site: "jasoseol",
    start_text: start,
    end_text: end,
    deadline_at: due,
    remaining_text: null,
    has_conflict: false,
  },
};

test("Jasoseol renders 23:50 Seoul, ticks and preserves that instant through title edit and approval", async ({
  page,
}) => {
  const state = await mockAnalyses(page, [review], source);
  await login(page);
  await page.clock.install({ time: new Date("2026-10-27T05:00:00Z") });
  await page.goto("/analyses/analysis-1");
  const region = page.getByRole("region", {
    name: "자소설닷컴 접수기간",
    exact: true,
  });
  await expect(region).toContainText(start);
  await expect(region).toContainText(end);
  await expect(region).toContainText("오후 11:50");
  await expect(region).not.toContainText("오후 2:50");
  await expect(region).toContainText("11일 9시간 50분 0초");
  await expect(
    page.getByLabel("후보 1 마감일 (한국 시간)", { exact: true }),
  ).toHaveValue("2026-11-07T23:50");
  await expect(page.locator(".candidate-evidence")).toContainText(end);
  await expect(page.locator(".candidate-evidence")).not.toContainText("신뢰도");
  await page.clock.fastForward(5000);
  await expect(region).toContainText("11일 9시간 49분 55초");
  expect(state.starts).toBe(0);
  expect(state.reads).toBe(1);
  expect(state.deadlines).toHaveLength(0);
  await page
    .getByLabel("후보 1 제목", { exact: true })
    .fill("[테스트] 자소설닷컴 지원 일정");
  await page
    .getByRole("button", { name: "검토 내용 저장", exact: true })
    .click();
  const approve = page.getByRole("button", {
    name: "선택한 1개 승인",
    exact: true,
  });
  await expect(approve).toBeEnabled();
  expect(state.analyses[0].candidates[0].due_at).toBe(due);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: test.info().outputPath("jasoseol-period.png"),
    fullPage: true,
  });
  await approve.click();
  await expect(
    page.getByRole("heading", { name: "마감일 등록 완료", exact: true }),
  ).toBeVisible();
  expect(state.deadlines).toHaveLength(1);
  expect(Date.parse(state.deadlines[0].due_at)).toBe(
    Date.parse("2026-11-07T14:50:00Z"),
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "마감일 등록 완료", exact: true }),
  ).toBeVisible();
  expect(state.deadlines).toHaveLength(1);
  expect(state.starts).toBe(0);
});

test("Jasoseol source clock conflicts require user review and never show a definite closing time", async ({
  page,
}) => {
  await mockAnalyses(
    page,
    [
      {
        ...review,
        warnings: ["자소설닷컴 공고의 접수기간 시간대를 확인하지 못했습니다."],
        candidates: [
          { ...review.candidates[0], due_at: null, selected: false },
        ],
        source_period: {
          ...review.source_period!,
          deadline_at: null,
          has_conflict: true,
        },
        date_choices: [{ ...review.date_choices![0], due_at: null }],
      },
    ],
    source,
  );
  await login(page);
  await page.goto("/analyses/analysis-1");
  const region = page.getByRole("region", {
    name: "자소설닷컴 접수기간",
    exact: true,
  });
  await expect(region).toContainText("충돌");
  await expect(region).toContainText("마감일 미확정");
  await expect(region).not.toContainText("마감일 (한국 시간)");
  await expect(
    page.getByLabel("후보 1 마감일 (한국 시간)", { exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "선택한 0개 승인", exact: true }),
  ).toBeDisabled();
});
