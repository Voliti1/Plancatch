import { test, expect } from "@playwright/test";
import { login } from "./fixtures";
import { aiSource, mockAnalyses, readyAnalysis } from "./analysis-fixtures";
import type { Analysis } from "../types/analysis";
import { extractedSummary } from "../features/sources/extracted-summary";

test("same-job company snapshot overrides recommended company labels and respects missing data", () => {
  const snapshot = (company: string | null) =>
    "회사명: 추천 기업\n[URL 마감일 HTML 검토 데이터]\n" +
    JSON.stringify({
      version: 1,
      submitted_url: "https://www.catch.co.kr/NCS/RecruitInfoDetails/577623",
      fetched_url: "https://www.catch.co.kr/NCS/RecruitInfoDetails/577623",
      company_name: company,
    }) +
    "\n[URL 마감일 HTML 검토 끝]";
  expect(extractedSummary(snapshot("CR그룹")).company).toBe("CR그룹");
  expect(extractedSummary(snapshot(null)).company).toBe(
    "원문에서 회사명을 확인하지 못했습니다.",
  );
});

const due = "2026-10-29T14:00:00+09:00";
const raw = "~ 10.29(목) 14시";
const evidence = `마감일 원문: ${raw}\n공고 메타데이터 마감일: ${due}`;
const source = {
  ...aiSource,
  title: "[테스트] 캐치 채용설명회",
  source_type: "url" as const,
  original_url: "https://www.catch.co.kr/NCS/RecruitInfoDetails/574650",
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
      id: "catch-date",
      raw_text: due,
      date: "2026-10-29",
      due_at: due,
      evidence_text: evidence,
    },
  ],
  source_period: {
    site: "catch",
    start_text: null,
    end_text: raw,
    deadline_at: due,
    remaining_text: null,
    has_conflict: false,
  },
};

test("Catch 24시 stays confirmed, displays its fixed company and preserves the final second on approval", async ({
  page,
}) => {
  const closing = "2026-11-08T23:59:59+09:00";
  const rawEnd = "~ 11.08(일) 24시";
  const proof = `마감일 원문: ${rawEnd}\n공고 메타데이터 마감일: ${closing}`;
  const text =
    "회사명: 추천 기업\n" +
    proof +
    "\n[URL 마감일 HTML 검토 데이터]\n" +
    JSON.stringify({
      version: 1,
      submitted_url: source.original_url,
      fetched_url: source.original_url,
      company_name: "CR그룹",
    }) +
    "\n[URL 마감일 HTML 검토 끝]";
  const state = await mockAnalyses(
    page,
    [
      {
        ...review,
        input_text: text,
        candidates: [
          { ...review.candidates[0], due_at: closing, evidence_text: proof },
        ],
        date_choices: [
          {
            ...review.date_choices![0],
            date: "2026-11-08",
            raw_text: closing,
            due_at: closing,
            evidence_text: proof,
          },
        ],
        source_period: {
          ...review.source_period!,
          end_text: rawEnd,
          deadline_at: closing,
        },
      },
    ],
    { ...source, extracted_text: text },
  );
  await login(page);
  await page.clock.install({ time: new Date("2026-10-27T05:00:00Z") });
  await page.goto("/analyses/analysis-1");
  const region = page.getByRole("region", {
    name: "캐치 접수기간",
    exact: true,
  });
  await expect(region).toContainText(rawEnd);
  await expect(region).not.toContainText("미확정");
  await expect(region).not.toContainText("충돌");
  await expect(
    page.getByRole("region", { name: "자료 정보 요약" }),
  ).toContainText("CR그룹");
  await expect(
    page.getByRole("region", { name: "자료 정보 요약" }),
  ).not.toContainText("추천 기업");
  await expect(
    page.getByLabel("후보 1 마감일 (한국 시간)", { exact: true }),
  ).toHaveValue("2026-11-08T23:59");
  await page.getByLabel("후보 1 제목", { exact: true }).fill("CR 지원 마감");
  await page
    .getByRole("button", { name: "검토 내용 저장", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "선택한 1개 승인", exact: true }),
  ).toBeEnabled();
  expect(state.analyses[0].candidates[0].due_at).toBe(closing);
  await page
    .getByRole("button", { name: "선택한 1개 승인", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "마감일 등록 완료", exact: true }),
  ).toBeVisible();
  expect(state.deadlines[0].due_at).toBe(closing);
  await page.reload();
  await expect(
    page.getByRole("region", { name: "자료 정보 요약" }),
  ).toContainText("CR그룹");
  expect(state.deadlines).toHaveLength(1);
});

test("Catch HTML period ticks, preserves deadline through edits and approval, and survives reload", async ({
  page,
}) => {
  const state = await mockAnalyses(page, [review], source);
  await login(page);
  await page.clock.install({ time: new Date("2026-10-27T05:00:00Z") });
  await page.goto("/analyses/analysis-1");
  const region = page.getByRole("region", {
    name: "캐치 접수기간",
    exact: true,
  });
  await expect(region).toContainText(raw);
  await expect(region).toContainText("2일 0시간 0분 0초");
  await expect(
    page.getByRole("region", { name: /사람인 접수기간|잡코리아 접수기간/ }),
  ).toHaveCount(0);
  await expect(page.locator(".candidate-evidence")).toContainText(raw);
  await expect(page.locator(".candidate-evidence")).toContainText(due);
  await expect(page.locator(".candidate-evidence")).not.toContainText("신뢰도");
  await expect(
    page.getByLabel("후보 1 마감일 (한국 시간)", { exact: true }),
  ).toHaveValue("2026-10-29T14:00");
  await page.clock.fastForward(5000);
  await expect(region).toContainText("1일 23시간 59분 55초");
  expect(state.starts).toBe(0);
  expect(state.reads).toBe(1);
  expect(state.deadlines).toHaveLength(0);
  await page
    .getByLabel("후보 1 제목", { exact: true })
    .fill("[테스트] 캐치 지원 일정");
  await page
    .getByRole("button", { name: "검토 내용 저장", exact: true })
    .click();
  const approve = page.getByRole("button", {
    name: "선택한 1개 승인",
    exact: true,
  });
  await expect(approve).toBeEnabled();
  expect(state.analyses[0].candidates[0].due_at).toBe(due);
  await page.screenshot({
    path: test.info().outputPath("catch-period.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
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

for (const conflict of [false, true]) {
  test(`Catch ${conflict ? "conflict" : "missing year"} requires a user-confirmed date`, async ({
    page,
  }) => {
    const warning = conflict
      ? "캐치 접수기간과 공고 메타데이터의 날짜가 충돌합니다."
      : "캐치 접수기간의 연도를 확정하지 못했습니다.";
    await mockAnalyses(
      page,
      [
        {
          ...review,
          warnings: [warning],
          candidates: [
            { ...review.candidates[0], due_at: null, selected: false },
          ],
          date_choices: [
            {
              id: "catch-date",
              raw_text: "10.29",
              date: null,
              due_at: null,
              evidence_text: `마감일 원문: ${raw}`,
            },
          ],
          source_period: {
            ...review.source_period!,
            deadline_at: null,
            has_conflict: conflict,
          },
        },
      ],
      source,
    );
    await login(page);
    await page.clock.install({ time: new Date("2040-10-27T05:00:00Z") });
    await page.goto("/analyses/analysis-1");
    const region = page.getByRole("region", {
      name: "캐치 접수기간",
      exact: true,
    });
    await expect(region).toContainText("마감일 미확정");
    await expect(
      page.getByRole("region", { name: "분석 주의사항" }),
    ).toContainText(warning);
    await expect(
      page.getByLabel("후보 1 마감일 (한국 시간)", { exact: true }),
    ).toHaveValue("");
    await expect(
      page.getByRole("button", { name: "선택한 0개 승인", exact: true }),
    ).toBeDisabled();
  });
}
