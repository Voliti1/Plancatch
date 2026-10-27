import { test, expect } from "@playwright/test";
import { login } from "./fixtures";
import { aiSource, mockAnalyses, readyAnalysis } from "./analysis-fixtures";
import type { Analysis } from "../types/analysis";

const due = "2026-10-31T14:59:59.999Z";
const evidence = `마감일 원문: 2026.10.31\n공고 메타데이터 마감일: ${due}`;
const source = {
  ...aiSource,
  title: "[테스트] 링커리어 채용공고",
  source_type: "url" as const,
  original_url: "https://linkareer.com/activity/356174",
  original_text: null,
  extracted_text: `(주)테스트기업\n${evidence}`,
};
const review: Analysis = {
  ...readyAnalysis,
  model: "html:url:v1",
  input_text: source.extracted_text,
  warnings: [
    "공고 화면에는 마감 날짜만 표시되어 있습니다. 링커리어 메타데이터의 마감 시각을 확인하고 필요하면 수정해 주세요.",
  ],
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
      id: "linkareer-date",
      raw_text: due,
      date: "2026-10-31",
      due_at: due,
      evidence_text: evidence,
    },
  ],
  source_period: {
    site: "linkareer",
    start_text: "2026.10.12",
    end_text: "2026.10.31",
    deadline_at: due,
    remaining_text: null,
    has_conflict: false,
  },
};

test("Linkareer explains the metadata time and preserves milliseconds through title edit, approval and reload", async ({
  page,
}) => {
  const state = await mockAnalyses(page, [review], source);
  await login(page);
  await page.clock.install({ time: new Date("2026-10-27T05:00:00Z") });
  await page.goto("/analyses/analysis-1");
  const region = page.getByRole("region", {
    name: "링커리어 접수기간",
    exact: true,
  });
  await expect(region).toContainText("2026.10.12");
  await expect(region).toContainText("2026.10.31");
  await expect(region).toContainText("오후 11:59");
  await expect(region).toContainText("4일 10시간 0분 0초");
  await expect(
    page.getByRole("region", { name: "분석 주의사항" }),
  ).toContainText("메타데이터의 마감 시각");
  await expect(
    page.getByLabel("후보 1 마감일 (한국 시간)", { exact: true }),
  ).toHaveValue("2026-10-31T23:59");
  await expect(page.locator(".candidate-evidence")).toContainText(due);
  await expect(page.locator(".candidate-evidence")).not.toContainText("신뢰도");
  await page.clock.fastForward(5000);
  await expect(region).toContainText("4일 9시간 59분 55초");
  expect(state.starts).toBe(0);
  expect(state.reads).toBe(1);
  expect(state.deadlines).toHaveLength(0);
  await page
    .getByLabel("후보 1 제목", { exact: true })
    .fill("[테스트] 링커리어 지원");
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
    path: test.info().outputPath("linkareer-period.png"),
    fullPage: true,
  });
  await approve.click();
  await expect(
    page.getByRole("heading", { name: "마감일 등록 완료", exact: true }),
  ).toBeVisible();
  expect(state.deadlines).toHaveLength(1);
  expect(state.deadlines[0].due_at).toBe(due);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "마감일 등록 완료", exact: true }),
  ).toBeVisible();
  expect(state.deadlines).toHaveLength(1);
  expect(state.starts).toBe(0);
});

test("Linkareer without a metadata clock requires a user time instead of defaulting to midnight", async ({
  page,
}) => {
  const dateEvidence = "마감일 원문: 2026.10.31";
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
        warnings: [
          "링커리어 마감 시각을 확정하지 못했습니다. 마감 시각을 직접 입력하세요.",
        ],
        candidates: [
          {
            ...review.candidates[0],
            due_at: null,
            selected: false,
            evidence_text: dateEvidence,
          },
        ],
        date_choices: [
          {
            id: "date-only",
            raw_text: "2026.10.31",
            date: "2026-10-31",
            due_at: null,
            evidence_text: dateEvidence,
          },
        ],
        source_period: { ...review.source_period!, deadline_at: null },
      },
    ],
    dateSource,
  );
  await login(page);
  await page.goto("/analyses/analysis-1");
  await expect(
    page.getByText("원문 마감 날짜는 2026-10-31입니다.", { exact: false }),
  ).toBeVisible();
  const dateInput = page.getByLabel("후보 1 마감일 (한국 시간)", {
    exact: true,
  });
  await expect(dateInput).toHaveValue("");
  await page
    .getByRole("button", { name: "2026.10.31 · 일시 입력 필요", exact: true })
    .click();
  await expect(dateInput).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "선택한 1개 승인", exact: true }),
  ).toBeDisabled();
  expect(state.deadlines).toHaveLength(0);
  await dateInput.fill("2026-10-31T18:00");
  await page
    .getByRole("button", { name: "검토 내용 저장", exact: true })
    .click();
  const approve = page.getByRole("button", {
    name: "선택한 1개 승인",
    exact: true,
  });
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(
    page.getByRole("heading", { name: "마감일 등록 완료", exact: true }),
  ).toBeVisible();
  expect(state.deadlines[0].due_at).toBe("2026-10-31T09:00:00.000Z");
  expect(state.starts).toBe(0);
});

test("Linkareer conflicting source dates stay unselected and cannot be approved", async ({
  page,
}) => {
  await mockAnalyses(
    page,
    [
      {
        ...review,
        warnings: ["링커리어 접수기간과 메타데이터 날짜가 일치하지 않습니다."],
        candidates: [
          { ...review.candidates[0], due_at: null, selected: false },
        ],
        date_choices: [{ ...review.date_choices![0], due_at: null }],
        source_period: {
          ...review.source_period!,
          deadline_at: null,
          has_conflict: true,
        },
      },
    ],
    source,
  );
  await login(page);
  await page.goto("/analyses/analysis-1");
  await expect(
    page.getByRole("region", { name: "링커리어 접수기간" }),
  ).toContainText("충돌");
  await expect(
    page.getByLabel("후보 1 마감일 (한국 시간)", { exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "선택한 0개 승인", exact: true }),
  ).toBeDisabled();
});
