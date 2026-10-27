import { test, expect } from "@playwright/test";
import { login } from "./fixtures";
import { aiSource, mockAnalyses, readyAnalysis } from "./analysis-fixtures";

const choices = [
  {
    id: "date-1",
    raw_text: "2026.11.03 23:59",
    date: "2026-11-03",
    due_at: "2026-11-03T23:59:00+09:00",
    evidence_text: "마감일 2026.11.03 23:59",
  },
  {
    id: "date-2",
    raw_text: "2026.11.05(목)",
    date: "2026-11-05",
    due_at: null,
    evidence_text: "마감일 2026.11.05(목)",
  },
];
const html = {
  ...readyAnalysis,
  model: "html:url:v1",
  date_choices: choices,
  candidates: [
    { ...readyAnalysis.candidates[0], due_at: null, selected: false },
  ],
};

test("날짜만 있는 URL은 23:59와 남은 기간을 표시하고 직접 승인한다", async ({
  page,
}) => {
  const due = "2026-11-10T23:59:00+09:00";
  const candidate = {
    ...readyAnalysis.candidates[0],
    due_at: due,
    selected: false,
    time_defaulted: true,
  };
  const state = await mockAnalyses(
    page,
    [
      {
        ...html,
        candidates: [candidate],
        warnings: [],
        date_choices: [],
        source_period: {
          site: "work24",
          start_text: null,
          end_text: "2026.11.10 (화)",
          deadline_at: due,
          remaining_text: null,
          has_conflict: false,
          time_defaulted: true,
        },
      },
    ],
    {
      ...aiSource,
      source_type: "url",
      original_url: "https://example.com/job",
      original_text: null,
    },
  );
  await login(page);
  await page.goto("/analyses/analysis-1");
  await expect(
    page.getByLabel("후보 1 마감일 (한국 시간)", { exact: true }),
  ).toHaveValue("2026-11-10T23:59");
  const period = page.getByRole("region", { name: "고용24 접수기간" });
  await expect(period).toContainText("오후 11시 59분으로 설정했습니다");
  await expect(period).not.toContainText("마감일 미확정");
  expect(state.deadlines).toHaveLength(0);
  await page.getByRole("checkbox", { name: "후보 1 포함" }).check();
  await page
    .getByRole("button", { name: "검토 내용 저장", exact: true })
    .click();
  await page
    .getByRole("button", { name: "선택한 1개 승인", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "마감일 등록 완료" }),
  ).toBeVisible();
  expect(state.deadlines[0].due_at).toBe(due);
  expect(state.starts).toBe(0);
});

test("choosing an exact HTML date preserves seconds and explicit offset when saving", async ({
  page,
}) => {
  const exact = "2026-11-03T14:59:01.123Z";
  await mockAnalyses(page, [
    { ...html, date_choices: [{ ...choices[0], due_at: exact }] },
  ]);
  await login(page);
  await page.goto("/analyses/analysis-1");
  await page
    .getByRole("group", { name: "후보 1 읽은 날짜 선택" })
    .getByRole("button")
    .click();
  const request = page.waitForRequest((r) => r.method() === "PATCH");
  await page
    .getByRole("button", { name: "검토 내용 저장", exact: true })
    .click();
  expect((await request).postDataJSON().candidates[0].due_at).toBe(exact);
});

test("HTML dates remain choices, missing time is never invented, selected date saves then approves", async ({
  page,
}) => {
  const state = await mockAnalyses(page, [html]);
  await login(page);
  await page.goto("/analyses/analysis-1");
  const group = page.getByRole("group", { name: "후보 1 읽은 날짜 선택" });
  await group.getByRole("button", { name: /2026.11.05/ }).click();
  await expect(
    page.getByLabel("후보 1 마감일 (한국 시간)", { exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("status").filter({ hasText: "빠진 연도나 시간" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "선택한 1개 승인", exact: true }),
  ).toBeDisabled();
  await group
    .getByRole("button", { name: "2026.11.03 23:59", exact: true })
    .click();
  await expect(
    page.getByLabel("후보 1 마감일 (한국 시간)", { exact: true }),
  ).toHaveValue("2026-11-03T23:59");
  await page
    .getByRole("button", { name: "검토 내용 저장", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "선택한 1개 승인", exact: true }),
  ).toBeEnabled();
  expect(state.deadlines).toHaveLength(0);
  await page
    .getByRole("button", { name: "선택한 1개 승인", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "마감일 등록 완료", exact: true }),
  ).toBeVisible();
  expect(state.deadlines).toHaveLength(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("open ended URL requires an explicitly entered date and selected candidate", async ({
  page,
}) => {
  const state = await mockAnalyses(page, [
    { ...html, date_choices: [], is_open_ended: true },
  ]);
  await login(page);
  await page.goto("/analyses/analysis-1");
  await expect(
    page.getByText(/원하는 마감 날짜와 시간을 직접 입력해야/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "선택한 0개 승인", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("후보 1 마감일 (한국 시간)", { exact: true })
    .fill("2026-11-10T18:00");
  await page
    .getByRole("checkbox", { name: "후보 1 포함", exact: true })
    .check();
  await page
    .getByRole("button", { name: "검토 내용 저장", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "선택한 1개 승인", exact: true }),
  ).toBeEnabled();
  expect(state.deadlines).toHaveLength(0);
});

test("a failed result retains read dates and can recover without an external AI request", async ({
  page,
}) => {
  const failed = {
    ...html,
    model: "legacy-ai",
    status: "failed" as const,
    candidates: [],
    error_message: "ai_evidence_not_in_source",
  };
  const state = await mockAnalyses(page, [failed]);
  let recoveries = 0;
  await page.route(
    "**/test-api/api/ai-analyses/analysis-1/recover-html",
    async (route) => {
      recoveries++;
      const recovered = { ...html, id: "html-recovered" };
      state.analyses.unshift(recovered);
      return route.fulfill({ status: 202, json: recovered });
    },
  );
  await login(page);
  await page.goto("/analyses/analysis-1");
  await expect(
    page.getByRole("heading", {
      name: "읽어 온 날짜로 검토 계속하기",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "HTML 날짜로 검토 계속", exact: true })
    .click();
  await expect(page).toHaveURL(/\/analyses\/html-recovered$/);
  await expect(
    page.getByRole("group", { name: "후보 1 읽은 날짜 선택" }),
  ).toBeVisible();
  expect(recoveries).toBe(1);
  expect(state.starts).toBe(0);
  expect(state.analyses.find((a) => a.id === "analysis-1")!.status).toBe(
    "failed",
  );
  await page.screenshot({
    path: test.info().outputPath("html-date-recovery.png"),
    fullPage: true,
  });
});

test("URL verification never requests AI consent and does not inherit the 40000 AI limit", async ({
  page,
}) => {
  const state = await mockAnalyses(page, [], {
    ...aiSource,
    source_type: "url",
    original_url: "https://example.com/notice",
    original_text: null,
    extracted_text: "공고".repeat(21000),
  });
  await page.route("**/test-api/api/sources/ai-source/ai-analyses", (route) => {
    expect(route.request().postDataJSON()).toEqual({
      allow_external_ai: false,
    });
    state.analyses.unshift(html);
    return route.fulfill({ status: 202, json: html });
  });
  await login(page);
  await page.goto("/sources/ai-source");
  await expect(
    page.getByRole("checkbox", { name: /Google Gemini/ }),
  ).toHaveCount(0);
  await page
    .getByRole("checkbox", {
      name: "HTML에서 읽은 날짜를 직접 검토한 후 등록하겠습니다.",
    })
    .check();
  await page
    .getByRole("button", { name: "HTML 마감일 확인", exact: true })
    .click();
  await expect(page).toHaveURL(/\/analyses\/analysis-1$/);
});
