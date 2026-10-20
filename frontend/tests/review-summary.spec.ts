import { test, expect } from "@playwright/test";
import { login } from "./fixtures";
import { aiSource, mockAnalyses, readyAnalysis } from "./analysis-fixtures";

const snapshot =
  "광고 메뉴 추천 공고 숨길 내용\n회사명: 예시테크(주)\n마감일 2026.11.03 23:59\n불필요한 전체 원문 끝";
const evidence =
  "불필요한 근거 머리말\n마감일 2026.11.03 23:59\n접수 종료\n" +
  "긴 원문 꼬리말".repeat(100);
const source = {
  ...aiSource,
  source_type: "url",
  title: "현재 공고 제목",
  original_url: "https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=12345678",
  extracted_text: "회사명: 수정된 다른 회사",
};
const analysis = {
  ...readyAnalysis,
  input_text: snapshot,
  candidates: [
    {
      ...readyAnalysis.candidates[0],
      evidence_text: evidence,
    },
  ],
  warnings: [],
};

test("review shows summary and brief evidence without full source or a full-source control", async ({
  page,
}) => {
  const state = await mockAnalyses(page, [analysis], source);
  await login(page);
  await page.goto("/analyses/analysis-1");
  const summary = page.getByRole("region", { name: "자료 정보 요약" });
  await expect(summary).toContainText("현재 공고 제목");
  await expect(summary).toContainText("예시테크(주)");
  await expect(summary).not.toContainText("수정된 다른 회사");
  await expect(
    page.getByRole("link", { name: "원본 페이지 열기 ↗" }),
  ).toHaveAttribute("href", source.original_url);
  await expect(
    page.getByRole("heading", { name: "분석에 사용한 원문" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /전체.*원문|전체.*추출|자세히 보기/ }),
  ).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(
    "광고 메뉴 추천 공고 숨길 내용",
  );
  await expect(page.locator("main")).not.toContainText("불필요한 전체 원문 끝");
  const displayed = page.locator(".candidate-evidence .analysis-text");
  await expect(displayed).toContainText("마감일 2026.11.03 23:59");
  await expect(displayed).not.toContainText("긴 원문 꼬리말");
  expect((await displayed.innerText()).length).toBeLessThanOrEqual(242);
  await page
    .getByLabel("후보 1 제목", { exact: true })
    .fill("수정한 일정 제목");
  await page
    .getByRole("button", { name: "검토 내용 저장", exact: true })
    .click();
  await expect(
    page.getByText("검토 내용을 저장했습니다.", { exact: true }),
  ).toBeVisible();
  expect(state.analyses[0].input_text).toBe(snapshot);
  expect(state.analyses[0].candidates[0].evidence_text).toBe(evidence);
  await page
    .getByRole("button", { name: "선택한 1개 승인", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "마감일 등록 완료" }),
  ).toBeVisible();
  expect(state.deadlines[0].evidence_text).toBe(evidence);
  await page.reload();
  await expect(displayed).toContainText("마감일 2026.11.03 23:59");
  await expect(page.locator("main")).not.toContainText("불필요한 전체 원문 끝");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: test.info().outputPath("review-summary.png"),
    fullPage: true,
  });
});

test("failed analysis still shows snapshot company, without dumping source", async ({
  page,
}) => {
  await mockAnalyses(
    page,
    [
      {
        ...analysis,
        status: "failed",
        candidates: [],
        error_message: "ai_evidence_not_in_source",
      },
    ],
    source,
  );
  await login(page);
  await page.goto("/analyses/analysis-1");
  await expect(
    page.getByRole("region", { name: "자료 정보 요약" }),
  ).toContainText("예시테크(주)");
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(page.locator("main")).not.toContainText("불필요한 전체 원문 끝");
});

test("source metadata failure does not prevent candidate approval", async ({
  page,
}) => {
  const state = await mockAnalyses(page, [analysis], source);
  await page.route("**/test-api/api/sources/ai-source", (route) =>
    route.fulfill({ status: 404, json: { detail: "Source not found" } }),
  );
  await login(page);
  await page.goto("/analyses/analysis-1");
  await expect(
    page.getByText(
      "자료 정보를 불러오지 못했습니다. 마감일 검토는 계속할 수 있습니다.",
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "선택한 1개 승인", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "마감일 등록 완료" }),
  ).toBeVisible();
  expect(state.deadlines).toHaveLength(1);
});

test("text source has no external link and unknown company is not invented", async ({
  page,
}) => {
  await mockAnalyses(page);
  await login(page);
  await page.goto("/analyses/analysis-1");
  await expect(
    page.getByRole("region", { name: "자료 정보 요약" }),
  ).toContainText("원문에서 회사명을 확인하지 못했습니다.");
  await expect(
    page.getByRole("link", { name: "원본 페이지 열기 ↗" }),
  ).toHaveCount(0);
});

test("unsafe source link is never rendered", async ({ page }) => {
  await mockAnalyses(page, [analysis], {
    ...source,
    original_url: "javascript:alert(1)",
  });
  await login(page);
  await page.goto("/analyses/analysis-1");
  await expect(
    page.getByRole("region", { name: "자료 정보 요약" }),
  ).toContainText("현재 공고 제목");
  await expect(
    page.getByRole("link", { name: "원본 페이지 열기 ↗" }),
  ).toHaveCount(0);
});
