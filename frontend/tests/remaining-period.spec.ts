import { test, expect } from "@playwright/test";
import { login } from "./fixtures";
import { mockAnalyses, readyAnalysis } from "./analysis-fixtures";
import { remainingPeriod } from "../features/analyses/remaining-period";
import { extractedSummary } from "../features/sources/extracted-summary";

const now = Date.parse("2026-10-13T14:58:50Z");
const due = "2026-11-01T23:59:00+09:00";
const analysis = {
  ...readyAnalysis,
  candidates: [{ ...readyAnalysis.candidates[0], due_at: due }],
  warnings: [],
  source_period: {
    start_text: "2026.10.01 00:00",
    end_text: "2026.11.01 23:59",
    deadline_at: due,
    remaining_text: "19일 09:49:52",
    has_conflict: false,
  },
};

test("Saramin original and normalized evidence do not duplicate summary deadlines", () => {
  const text =
    "(주)테스트기업\n마감일\n2026.11.01 23:59\n마감일 원문: 2026.11.01 23:59\n마감일 (정규화): 2026-11-01T23:59:00\n사이트 남은 기간 (추출 당시): 0일 00:00:00";
  expect(extractedSummary(text)).toEqual({
    company: "(주)테스트기업",
    deadline: "2026.11.01 23:59",
  });
  expect(
    extractedSummary(
      "마감일 원문: 2026.11.01 23:59\n마감일 (정규화): 2026-11-01T23:59:00",
    ).deadline,
  ).toBe("2026.11.01 23:59");
});

test("remaining period handles invalid, subsecond, exact closing and offset dates", () => {
  expect(remainingPeriod(null, now)).toBe("마감일 미확정");
  expect(remainingPeriod("invalid", now)).toBe("마감일 미확정");
  expect(remainingPeriod(due, null)).toBe("계산 중…");
  expect(remainingPeriod(due, now)).toBe("19일 0시간 0분 10초");
  const closing = Date.parse(due);
  expect(remainingPeriod(due, closing - 1)).toBe("0일 0시간 0분 1초");
  expect(remainingPeriod(due, closing)).toBe("마감됨");
  expect(remainingPeriod(due, closing + 60000)).toBe("마감됨");
  expect(remainingPeriod("2026-11-01T14:59:00Z", now)).toBe(
    remainingPeriod(due, now),
  );
});

test("source timer stays a snapshot while current remaining time ticks without API writes", async ({
  page,
}) => {
  const state = await mockAnalyses(page, [analysis]);
  await login(page);
  await page.clock.install({ time: new Date(now) });
  await page.goto("/analyses/analysis-1");
  const period = page.getByRole("region", {
    name: "사람인 접수기간",
    exact: true,
  });
  await expect(period).toContainText("2026.11.01 23:59");
  await expect(period).toContainText("19일 0시간 0분 10초");
  await expect(period).toContainText("19일 09:49:52");
  await page.clock.fastForward(5000);
  await expect(period).toContainText("19일 0시간 0분 5초");
  await expect(period).toContainText("19일 09:49:52");
  expect(state.reads).toBe(1);
  expect(state.starts).toBe(0);
  expect(state.deadlines).toHaveLength(0);
  await expect(page.locator(".remaining-period")).toContainText(
    "19일 0시간 0분 5초",
  );
  await page.screenshot({
    path: test.info().outputPath("saramin-period.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("edited draft countdown is provisional and updates to saved or missing date", async ({
  page,
}) => {
  await mockAnalyses(page, [analysis]);
  await login(page);
  await page.clock.install({ time: new Date(now) });
  await page.goto("/analyses/analysis-1");
  await page
    .getByLabel("후보 1 마감일 (한국 시간)", { exact: true })
    .fill("2026-10-14T23:59");
  await expect(page.locator(".remaining-period")).toContainText("수정 중인");
  await expect(page.locator(".remaining-period")).toContainText(
    "1일 0시간 0분 10초",
  );
  await expect(
    page.getByRole("region", { name: "사람인 접수기간" }),
  ).toContainText("2026.11.01 23:59");
  await page
    .getByRole("button", { name: "검토 내용 저장", exact: true })
    .click();
  await expect(page.locator(".remaining-period")).not.toContainText(
    "수정 중인",
  );
  await page.getByLabel("후보 1 마감일 (한국 시간)", { exact: true }).fill("");
  await expect(page.locator(".remaining-period")).toContainText(
    "마감일 미확정",
  );
});

test("older and approved analyses remain compatible, expired dates show closed", async ({
  page,
}) => {
  const past = {
    ...analysis,
    status: "approved" as const,
    source_period: null,
  };
  await mockAnalyses(page, [past]);
  await login(page);
  await page.clock.install({ time: new Date(Date.parse(due) + 60000) });
  await page.goto("/analyses/analysis-1");
  await expect(
    page.getByRole("region", { name: "사람인 접수기간" }),
  ).toHaveCount(0);
  await expect(page.locator(".remaining-period")).toContainText("마감됨");
  await expect(
    page.getByRole("button", { name: /승인|검토 내용 저장/ }),
  ).toHaveCount(0);
});

test("conflicting original period is not displayed as a definite closing date", async ({
  page,
}) => {
  await mockAnalyses(page, [
    {
      ...analysis,
      candidates: [],
      source_period: {
        ...analysis.source_period,
        end_text: null,
        deadline_at: null,
        has_conflict: true,
      },
    },
  ]);
  await login(page);
  await page.goto("/analyses/analysis-1");
  const period = page.getByRole("region", { name: "사람인 접수기간" });
  await expect(period).toContainText("마감일 미확정");
  await expect(period).toContainText("충돌");
});

test("initial HTML timer zeros do not show an open deadline as closed", async ({
  page,
}) => {
  await mockAnalyses(page, [
    {
      ...analysis,
      source_period: {
        ...analysis.source_period,
        remaining_text: "0일 00:00:00",
      },
    },
  ]);
  await login(page);
  await page.clock.install({ time: new Date(now) });
  await page.goto("/analyses/analysis-1");
  const period = page.getByRole("region", { name: "사람인 접수기간" });
  await expect(period).toContainText("19일 0시간 0분 10초");
  await expect(period).toContainText("초기값일 수 있습니다");
  await expect(period).not.toContainText("마감됨");
});
