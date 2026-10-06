import { test, expect } from "@playwright/test";
import { login, mockApi } from "./fixtures";
import { extractedSummary } from "../features/sources/extracted-summary";
import type { Source } from "../types/api";

const text = [
  "로그인",
  "회원가입",
  "(주)원익홀딩스",
  "2026 원익그룹 신입 공채 모집",
  "마감일",
  "2026.10.12 23:59",
  "자격 요건과 근무 조건은 전체 내용에서 확인합니다.",
  ...Array.from(
    { length: 100 },
    (_, index) => `상세 내용 ${index + 1}: 테스트용 긴 원문입니다.`,
  ),
  "<script>window.untrustedSource = true</script>",
].join("\n");
const source: Source = {
  id: "summary-source",
  source_type: "url",
  title: "사용자가 정한 일정 제목",
  original_url: "https://example.com/job",
  original_text: null,
  extracted_text: text,
  storage_key: null,
  processing_status: "extracted",
  error_message: null,
  created_at: "2026-10-06T00:00:00Z",
  updated_at: "2026-10-06T00:00:00Z",
};
async function openSource(
  page: import("@playwright/test").Page,
  value = source,
) {
  await mockApi(page, [value]);
  await login(page);
  await page.goto(`/sources/${value.id}`);
  await expect(
    page.getByRole("heading", { name: "원본 자료 상세" }),
  ).toBeVisible();
}

test("summary shows only company and raw deadline without the full text", async ({
  page,
}) => {
  await openSource(page);
  const section = page.getByRole("region", {
    name: "추출된 내용",
    exact: true,
  });
  await expect(section.locator("dl")).toHaveText(
    "회사명(주)원익홀딩스마감일2026.10.12 23:59",
  );
  await expect(section.getByText(text, { exact: true })).not.toBeVisible();
  await expect(section).not.toContainText("확정된 회사명");
  await page.screenshot({
    path: test.info().outputPath("source-summary.png"),
    fullPage: true,
  });
});

test("modal preserves page layout and scroll, scrolls internally and closes with X", async ({
  page,
}) => {
  await openSource(page);
  const button = page.getByRole("button", { name: "자세히 보기", exact: true });
  await button.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => ({
    y: scrollY,
    height: document.documentElement.scrollHeight,
    card: document
      .querySelector(".source-detail")!
      .getBoundingClientRect()
      .toJSON(),
  }));
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET") writes.push(request.url());
  });
  await button.click();
  const dialog = page.getByRole("dialog", { name: "추출된 내용 자세히 보기" });
  await expect(dialog).toBeVisible();
  const whileOpen = await page.evaluate(() => ({
    y: scrollY,
    card: document
      .querySelector(".source-detail")!
      .getBoundingClientRect()
      .toJSON(),
  }));
  expect(whileOpen).toEqual({ y: before.y, card: before.card });
  await expect(dialog.locator(".source-text")).toHaveText(text);
  const body = dialog.getByLabel("전체 추출 내용", { exact: true });
  expect(
    await body.evaluate((el) => el.scrollHeight > el.clientHeight),
  ).toBeTruthy();
  const box = (await dialog.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  await body.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(dialog.locator("script")).toHaveCount(0);
  expect(await page.evaluate(() => "untrustedSource" in window)).toBeFalsy();
  await page.screenshot({ path: test.info().outputPath("source-modal.png") });
  await page.getByRole("button", { name: "자세히 보기 닫기" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(button).toBeFocused();
  const after = await page.evaluate(() => ({
    y: scrollY,
    height: document.documentElement.scrollHeight,
    card: document
      .querySelector(".source-detail")!
      .getBoundingClientRect()
      .toJSON(),
  }));
  expect(after).toEqual(before);
  expect(writes).toEqual([]);
});

test("modal closes on outside click, not an inside click, and can reopen", async ({
  page,
}) => {
  await openSource(page);
  const button = page.getByRole("button", { name: "자세히 보기", exact: true });
  await button.click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("heading", { name: "추출된 내용 자세히 보기" })
    .click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(4, 4);
  await expect(dialog).not.toBeVisible();
  await expect(button).toBeFocused();
  await button.click();
  await expect(dialog).toBeVisible();
});

test("modal traps keyboard focus and Escape restores the trigger", async ({
  page,
}) => {
  await openSource(page);
  const button = page.getByRole("button", { name: "자세히 보기", exact: true });
  await button.click();
  const dialog = page.getByRole("dialog");
  await expect(
    page.getByRole("button", { name: "자세히 보기 닫기" }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByLabel("전체 추출 내용", { exact: true }),
  ).toBeFocused();
  for (let index = 0; index < 4; index++) {
    await page.keyboard.press("Tab");
    expect(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
    ).toBeTruthy();
  }
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(button).toBeFocused();
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).overflow,
    ),
  ).not.toBe("hidden");
});

test("missing or conflicting values are not invented from the source title", async ({
  page,
}) => {
  await openSource(page, {
    ...source,
    extracted_text:
      "회사명: 첫 번째 회사\n기업명: 다른 회사\n마감일: 2026.10.12 23:59\n마감일: 2026.10.31 23:59\n기타 긴 내용",
  });
  const summary = page.locator(".extracted-summary");
  await expect(summary).toContainText("여러 회사명");
  await expect(summary).toContainText("여러 마감일");
  await expect(summary).not.toContainText(source.title!);
});

test("empty and not-yet-extracted sources do not offer an empty popup", async ({
  page,
}) => {
  await openSource(page, { ...source, extracted_text: "" });
  await expect(
    page.getByText("추출된 내용이 없습니다.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "자세히 보기", exact: true }),
  ).toHaveCount(0);
  await page.route("**/test-api/api/sources/summary-source", (route) =>
    route.fulfill({
      json: { ...source, extracted_text: null, processing_status: "pending" },
    }),
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "원문 추출", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "추출된 내용", exact: true }),
  ).toHaveCount(0);
});

const cases = [
  {
    name: "explicit labels",
    text: "광고 회사\n기업명\n삼성전자\n접수 마감일: 2026년 10월 31일 오후 6시",
    company: "삼성전자",
    deadline: "2026년 10월 31일 오후 6시",
  },
  {
    name: "same-page JobPosting",
    text: "(주)텍슨\n[동일 페이지의 채용공고 구조화 데이터: JSON-LD JobPosting]\n마감일 (validThrough): 2026-10-31T23:59",
    company: "(주)텍슨",
    deadline: "2026-10-31T23:59",
  },
  {
    name: "partial date preserved",
    text: "회사명: 회사 테스트\n마감일\n~10/31(토)",
    company: "회사 테스트",
    deadline: "~10/31(토)",
  },
  {
    name: "open-ended deadline",
    text: "㈜테스트\n접수 마감: 채용 시 마감",
    company: "㈜테스트",
    deadline: "채용 시 마감",
  },
  {
    name: "duplicate displayed deadline",
    text: "(주)테스트\n㈜테스트\n마감일: 2026.10.31 23:59\nvalidThrough: 2026-10-31T23:59",
    company: "㈜테스트",
    deadline: "2026-10-31T23:59",
  },
  {
    name: "unlabelled other dates",
    text: "오늘 2026.10.06\n설립 2001년 3월\n회사명은 예시일 뿐입니다.\n마감일변경 안내 2026.10.31",
    company: "원문에서 회사명을 확인하지 못했습니다.",
    deadline: "원문에서 마감일을 확인하지 못했습니다.",
  },
  {
    name: "conflicting standalone companies",
    text: "(주)첫회사\n(주)둘째회사\n마감일: 미정",
    company: "여러 회사명이 있어 원문 확인이 필요합니다.",
    deadline: "미정",
  },
];
test.describe("narrow desktop viewport", () => {
  test.use({
    viewport: { width: 412, height: 915 },
    isMobile: false,
    hasTouch: false,
  });
  test("opening the modal never introduces an extra scrollbar gap", async ({
    page,
  }) => {
    await openSource(page);
    const trigger = page.getByRole("button", {
      name: "자세히 보기",
      exact: true,
    });
    await trigger.scrollIntoViewIfNeeded();
    const before = await page.locator(".source-detail").boundingBox();
    const gap = await page.evaluate(
      () => innerWidth - document.documentElement.clientWidth,
    );
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toHaveAttribute(
      "data-reserve-gutter",
      String(gap > 0),
    );
    expect(await page.locator(".source-detail").boundingBox()).toEqual(before);
    await page.keyboard.press("Escape");
    expect(await page.locator(".source-detail").boundingBox()).toEqual(before);
  });
});
for (const value of cases) {
  test(`summary parser: ${value.name}`, () => {
    expect(extractedSummary(value.text)).toEqual({
      company: value.company,
      deadline: value.deadline,
    });
  });
}
