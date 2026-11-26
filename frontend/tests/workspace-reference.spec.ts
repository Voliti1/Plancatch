import { expect, test } from "@playwright/test";
import { login, mockApi } from "./fixtures";
import { aiSource } from "./analysis-fixtures";
import type { Deadline } from "../types/api";

const deadline: Deadline = {
  id: "reference-deadline",
  title: "[테스트] 프로젝트 보고서 제출",
  due_at: "2026-12-03T08:00:00Z",
  source_id: aiSource.id,
  description: null,
  deadline_type: "과제",
  evidence_text: null,
  confidence: null,
  is_confirmed: true,
  safe_due_at: null,
  safety_buffer_minutes: null,
  created_at: "2026-11-26T00:00:00Z",
  updated_at: "2026-11-26T00:00:00Z",
};

test("시안 스타일에서도 메뉴 이름과 현재 위치, 실제 요약 및 입력 접근성을 유지한다", async ({
  page,
}) => {
  await mockApi(page, [aiSource], { deadlines: [deadline] });
  await login(page);
  await expect(page.locator(".sidebar .brand")).toHaveText("PPlanCatch.");
  await expect(
    page.getByRole("region", { name: "할 일", exact: true }),
  ).toBeVisible();
  const menu = page.getByRole("navigation", { name: "주 메뉴" });
  await expect(menu.getByRole("link")).toHaveCount(6);
  await expect(
    menu.locator('svg[aria-hidden="true"][focusable="false"]'),
  ).toHaveCount(6);
  await expect(menu).not.toContainText(/[◈▦◷▥▤↗]/);
  await expect(
    menu.getByRole("link", { name: "대시보드", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".dashboard-stats strong")).toHaveText([
    "보관한 자료 1개",
    "등록한 일정 1개",
  ]);
  await expect(
    page.getByRole("link").filter({ hasText: deadline.title }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("reference-dashboard.png"),
    fullPage: true,
  });
  await page
    .getByRole("link", { name: "새 일정 등록하기 ↗", exact: true })
    .click();
  await expect(menu.locator("[aria-current]")).toHaveCount(0);
  const tabs = page.getByRole("tablist", { name: "자료 입력 방식" });
  await tabs.getByRole("tab").first().press("ArrowRight");
  await expect(
    page.getByLabel("웹페이지 주소 (URL)", { exact: true }),
  ).toBeVisible();
  await tabs.getByRole("tab").nth(1).press("Home");
  const drop = page.getByRole("button", {
    name: "PDF 또는 이미지 파일 선택",
    exact: true,
  });
  await expect(drop).toBeVisible();
  expect((await drop.boundingBox())!.height).toBeLessThanOrEqual(160);
  const support = page.locator(".source-file-support");
  await expect(support).not.toHaveAttribute("open");
  await support.locator("summary").press("Enter");
  await expect(support).toContainText("동의 후 AI(구글 Gemini)");
  await support.locator("summary").press("Enter");
  // Keyboard checks may scroll the page. Capture the normal top-of-page layout.
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: test.info().outputPath("reference-registration.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "다크 모드로 전환", exact: true })
    .click();
  await expect(page.locator(".source-registration")).toHaveCSS(
    "background-color",
    "rgb(28, 38, 54)",
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: test.info().outputPath("reference-registration-dark.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(drop).toBeVisible();
});
