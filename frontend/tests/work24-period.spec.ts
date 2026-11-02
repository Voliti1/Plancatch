import { test, expect } from "@playwright/test";
import { login } from "./fixtures";
import { aiSource, mockAnalyses, readyAnalysis } from "./analysis-fixtures";
import type { Analysis } from "../types/analysis";

const raw = "2026.11.10 (화) 24:00";
const due = "2026-11-11T00:00:00+09:00";
const evidence = `마감일 원문: ${raw}`;
const savedText = `${evidence}\n회사명: 추천 기업\n[URL 마감일 HTML 검토 데이터]\n${JSON.stringify(
  {
    version: 1,
    submitted_url: "https://m.work24.go.kr/",
    fetched_url: "https://m.work24.go.kr/",
    company_name: "(주)엔케이티엠에스",
  },
)}\n[URL 마감일 HTML 검토 끝]`;
const source = {
  ...aiSource,
  title: "[테스트] 고용24 시설관리원 구인",
  source_type: "url" as const,
  original_url:
    "https://m.work24.go.kr/wk/a/b/1500/empDetailAuthView.do?wantedAuthNo=K150122610270007&infoTypeCd=VALIDATION&infoTypeGroup=tb_workinfoworknet",
  original_text: null,
  extracted_text: savedText,
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
      id: "work24-date",
      raw_text: due,
      date: "2026-11-11",
      due_at: due,
      evidence_text: evidence,
    },
  ],
  source_period: {
    site: "work24",
    start_text: null,
    end_text: raw,
    deadline_at: due,
    remaining_text: null,
    has_conflict: false,
  },
};

test("Work24 keeps raw 24:00 and the next-day Seoul midnight through edit, approval and refresh", async ({
  page,
}) => {
  const state = await mockAnalyses(page, [review], source);
  await login(page);
  await page.clock.install({ time: new Date("2026-10-27T05:00:00Z") });
  await page.goto("/analyses/analysis-1");
  const region = page.getByRole("region", {
    name: "고용24 접수기간",
    exact: true,
  });
  await expect(region).toContainText(raw);
  await expect(
    page.getByRole("region", { name: "자료 정보 요약", exact: true }),
  ).toContainText("(주)엔케이티엠에스");
  await expect(
    page.getByRole("region", { name: "자료 정보 요약", exact: true }),
  ).not.toContainText("추천 기업");
  await expect(region).toContainText("2026. 11. 11.");
  await expect(region).toContainText("다음 날 00:00");
  await expect(region).toContainText("14일 10시간 0분 0초");
  const dateInput = page.getByLabel("후보 1 마감일 (한국 시간)", {
    exact: true,
  });
  await expect(dateInput).toHaveValue("2026-11-11T00:00");
  await expect(page.locator(".candidate-evidence")).toContainText(raw);
  await expect(page.locator(".candidate-evidence")).not.toContainText("신뢰도");
  await page.clock.fastForward(5000);
  await expect(region).toContainText("14일 9시간 59분 55초");
  expect(state.starts).toBe(0);
  expect(state.reads).toBe(1);
  expect(state.deadlines).toHaveLength(0);
  await page
    .getByLabel("후보 1 제목", { exact: true })
    .fill("[테스트] 고용24 지원 일정");
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
    path: test.info().outputPath("work24-period.png"),
    fullPage: true,
  });
  await approve.click();
  await expect(
    page.getByRole("heading", { name: "마감일 등록 완료", exact: true }),
  ).toBeVisible();
  expect(state.deadlines).toHaveLength(1);
  expect(Date.parse(state.deadlines[0].due_at)).toBe(
    Date.parse("2026-11-10T15:00:00Z"),
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "마감일 등록 완료", exact: true }),
  ).toBeVisible();
  expect(state.deadlines).toHaveLength(1);
  expect(state.starts).toBe(0);
});

test("Work24 missing clock and conflicting weekday never prefill a deadline", async ({
  page,
}) => {
  await mockAnalyses(
    page,
    [
      {
        ...review,
        candidates: [
          { ...review.candidates[0], due_at: null, selected: false },
        ],
        warnings: ["고용24 공고의 마감 날짜·요일·시각을 확인해 주세요."],
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
  const region = page.getByRole("region", { name: "고용24 접수기간" });
  await expect(region).toContainText("충돌");
  await expect(region).not.toContainText("마감일 (한국 시간)");
  await expect(
    page.getByLabel("후보 1 마감일 (한국 시간)", { exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "선택한 0개 승인", exact: true }),
  ).toBeDisabled();
});

test("Work24 date-only field requires the user to enter a clock", async ({
  page,
}) => {
  const dateEvidence = "마감일 원문: 2026.11.10 (화)";
  const dateSource = {
    ...source,
    extracted_text: `(주)테스트기업\n${dateEvidence}`,
  };
  const state = await mockAnalyses(
    page,
    [
      {
        ...review,
        input_text: dateSource.extracted_text,
        candidates: [
          {
            ...review.candidates[0],
            due_at: null,
            selected: false,
            evidence_text: dateEvidence,
          },
        ],
        warnings: ["고용24 마감 시각을 직접 입력하세요."],
        source_period: {
          ...review.source_period!,
          end_text: "2026.11.10 (화)",
          deadline_at: null,
        },
        date_choices: [
          {
            id: "date-only",
            raw_text: "2026.11.10 (화)",
            date: "2026-11-10",
            due_at: null,
            evidence_text: dateEvidence,
          },
        ],
      },
    ],
    dateSource,
  );
  await login(page);
  await page.goto("/analyses/analysis-1");
  await expect(
    page.getByText("원문 마감 날짜는 2026-11-10입니다.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByLabel("후보 1 마감일 (한국 시간)", { exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "선택한 0개 승인", exact: true }),
  ).toBeDisabled();
  expect(state.deadlines).toHaveLength(0);
});
