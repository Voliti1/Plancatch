import { test, expect } from "@playwright/test";
import { login } from "./fixtures";
import { mockAnalyses, readyAnalysis } from "./analysis-fixtures";

const direct = {
  ...readyAnalysis,
  model: "html:saramin:v1",
  warnings: [],
  candidates: [
    {
      ...readyAnalysis.candidates[0],
      title: "사람인 공고 접수 마감",
      due_at: "2026-10-16T23:59:00+09:00",
      evidence_text: "마감일 원문: 2026.10.16 23:59",
      confidence: 1,
    },
  ],
};

test("HTML analysis is labelled as direct extraction, not AI confidence; review and approval still work", async ({
  page,
}) => {
  const state = await mockAnalyses(page, [direct]);
  await login(page);
  await page.goto("/analyses/analysis-1");
  await expect(
    page.getByRole("heading", { name: "마감일 검토", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Gemini를 호출하거나 원문을 외부 AI에 전송하지 않습니다/),
  ).toBeVisible();
  await expect(page.locator(".candidate-evidence")).toContainText(
    "AI 추정값이 아닙니다",
  );
  await expect(page.locator(".candidate-evidence")).not.toContainText("신뢰도");
  await expect(
    page.getByLabel("후보 1 마감일 (한국 시간)", { exact: true }),
  ).toHaveValue("2026-10-16T23:59");
  await page
    .getByRole("button", { name: "선택한 1개 승인", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "마감일 등록 완료", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".candidate-evidence")).not.toContainText("신뢰도");
  expect(state.deadlines).toHaveLength(1);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "마감일 검토", exact: true }),
  ).toBeVisible();
  expect(state.deadlines).toHaveLength(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: test.info().outputPath("html-direct-analysis.png"),
    fullPage: true,
  });
});

test("unresolved HTML periods remain editable review results rather than AI errors or invented dates", async ({
  page,
}) => {
  await mockAnalyses(page, [
    {
      ...direct,
      warnings: ["마감 날짜·시간을 확인해 주세요."],
      candidates: [
        {
          ...direct.candidates[0],
          due_at: null,
          selected: false,
          confidence: 0,
        },
      ],
    },
  ]);
  await login(page);
  await page.goto("/analyses/analysis-1");
  await expect(page.getByText("검토 대기", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "분석 주의사항" }),
  ).toContainText("날짜·시간");
  await expect(
    page.getByLabel("후보 1 마감일 (한국 시간)", { exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "선택한 0개 승인", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".candidate-evidence")).not.toContainText("신뢰도");
});
