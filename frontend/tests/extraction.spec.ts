import { test, expect } from "@playwright/test";
import { login, mockApi } from "./fixtures";
import type { Source } from "../types/api";
const source: Source = {
  id: "extraction-source",
  title: "[테스트] 원문 추출",
  source_type: "text",
  original_url: null,
  original_text: "2026년 10월 1일 오전 9시(한국 시간)까지 제출합니다.",
  extracted_text: null,
  storage_key: null,
  processing_status: "pending",
  error_message: null,
  created_at: "2026-09-30T00:00:00Z",
  updated_at: "2026-09-30T00:00:00Z",
};
test("text extraction sends no body, locks edits and stops polling after success", async ({
  page,
}) => {
  await mockApi(page, [source]);
  let requested = false,
    posts = 0,
    reads = 0;
  await page.route(
    "**/test-api/api/sources/extraction-source/analyze",
    async (route) => {
      posts++;
      expect(route.request().postData()).toBeNull();
      requested = true;
      await route.fulfill({
        status: 202,
        json: { ...source, processing_status: "processing" },
      });
    },
  );
  await page.route("**/test-api/api/sources/extraction-source", (route) => {
    if (requested) reads++;
    return route.fulfill({
      json: requested
        ? {
            ...source,
            processing_status: "extracted",
            extracted_text: source.original_text,
          }
        : source,
    });
  });
  await login(page);
  await page.goto("/sources/extraction-source");
  await page.clock.install();
  await page.getByRole("button", { name: "원문 추출", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "추출 중…", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "자료 수정", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "자료 삭제", exact: true }),
  ).toBeDisabled();
  await page.clock.fastForward(2001);
  await expect(page.getByText("원문 추출 완료", { exact: true })).toBeVisible();
  const finishedReads = reads;
  await page.clock.fastForward(10000);
  expect(posts).toBe(1);
  expect(reads).toBe(finishedReads);
});
test("URL extraction failure explains login and collection restrictions", async ({
  page,
}) => {
  const urlSource = {
    ...source,
    source_type: "url",
    original_text: null,
    original_url: "https://example.com/test-only",
  };
  await mockApi(page, [urlSource]);
  let status = "pending";
  let error: string | null = null;
  await page.route(
    "**/test-api/api/sources/extraction-source/analyze",
    (route) => {
      status = "requires_login";
      error = "requires_login";
      return route.fulfill({
        status: 202,
        json: { ...urlSource, processing_status: "processing" },
      });
    },
  );
  await page.route("**/test-api/api/sources/extraction-source", (route) =>
    route.fulfill({
      json: { ...urlSource, processing_status: status, error_message: error },
    }),
  );
  await login(page);
  await page.goto("/sources/extraction-source");
  await page.getByRole("button", { name: "원문 추출", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "로그인이 필요한 페이지" }),
  ).toBeVisible();
  status = "failed";
  error = "robots_disallowed";
  await page.reload();
  await expect(
    page.getByRole("alert").filter({ hasText: "사이트의 수집 정책" }),
  ).toBeVisible();
});
test("polling times out, can resume and stops on navigation", async ({
  page,
}) => {
  await mockApi(page, [{ ...source, processing_status: "processing" }]);
  let reads = 0;
  await page.route("**/test-api/api/sources/extraction-source", (route) => {
    reads++;
    return route.fulfill({
      json: { ...source, processing_status: "processing" },
    });
  });
  await login(page);
  await page.clock.install();
  await page.goto("/sources/extraction-source");
  await expect(
    page.getByRole("button", { name: "추출 중…", exact: true }),
  ).toBeDisabled();
  await page.clock.fastForward(91000);
  await expect(
    page.getByRole("alert").filter({ hasText: "자동 조회를 중단했습니다" }),
  ).toBeVisible();
  const stopped = reads;
  await page.clock.fastForward(10000);
  expect(reads).toBe(stopped);
  await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  await page.clock.fastForward(2001);
  await expect.poll(() => reads).toBeGreaterThan(stopped);
  await page.getByRole("link", { name: "← 원본 자료 목록" }).click();
  await expect(page).toHaveURL(/\/sources$/);
  const exited = reads;
  await page.clock.fastForward(10000);
  expect(reads).toBe(exited);
});
test("capacity error preserves source and allows retry", async ({
  page,
}) => {
  await mockApi(page, [source]);
  await page.route(
    "**/test-api/api/sources/extraction-source/analyze",
    (route) =>
      route.fulfill({
        status: 429,
        json: { detail: "Extraction capacity reached; retry later" },
      }),
  );
  await login(page);
  await page.goto("/sources/extraction-source");
  await page.getByRole("button", { name: "원문 추출", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "처리 용량" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "원문 추출", exact: true }),
  ).toBeEnabled();
});
