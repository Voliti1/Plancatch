import { test, expect } from "@playwright/test";
import { login, mockApi } from "./fixtures";
import type { Source } from "../types/api";

const urlSource: Source = {
  id: "url-source",
  title: "프로젝트 안내",
  source_type: "url",
  original_url: "https://example.com/project",
  original_text: null,
  extracted_text: "제출은 10월 1일까지입니다.",
  storage_key: null,
  processing_status: "completed",
  error_message: null,
  created_at: "2026-09-16T00:00:00Z",
  updated_at: "2026-09-16T00:00:00Z",
};
const textSource: Source = {
  ...urlSource,
  id: "text-source",
  title: "수업 메모",
  source_type: "text",
  original_url: null,
  original_text: "첫 번째 줄\n두 번째 줄",
  extracted_text: null,
  processing_status: "pending",
};
test.beforeEach(async ({ page }) => {
  await mockApi(page, [urlSource, textSource]);
});

test("source detail, URL edit, cancel and confirmed deletion", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("link", { name: "원본 자료", exact: true }).click();
  await page.getByRole("link", { name: "프로젝트 안내 상세 보기" }).click();
  await expect(page).toHaveURL(/\/sources\/url-source$/);
  await expect(
    page.getByRole("heading", { name: "원본 자료 상세" }),
  ).toBeVisible();
  await expect(page.getByText("처리 완료", { exact: true })).toBeVisible();
  await expect(
    page.getByText("제출은 10월 1일까지입니다.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "자료 수정", exact: true }).click();
  await page.getByLabel("자료 제목 (선택)").fill("취소할 제목");
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "프로젝트 안내", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "자료 수정", exact: true }).click();
  await page.getByLabel("자료 제목 (선택)").fill("수정된 안내");
  await page
    .getByLabel("원본 URL", { exact: true })
    .fill("https://example.com/updated?notice=1");
  const update = page.waitForRequest((request) => request.method() === "PATCH");
  await page.getByRole("button", { name: "변경 사항 저장" }).click();
  expect((await update).postDataJSON()).toEqual({
    title: "수정된 안내",
    original_url: "https://example.com/updated?notice=1",
  });
  await expect(page.getByText("변경 사항을 저장했습니다.")).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "수정된 안내", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /https:\/\/example.com\/updated/ }),
  ).toHaveAttribute("href", "https://example.com/updated?notice=1");
  await expect(
    page.getByText("제출은 10월 1일까지입니다.", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("source-detail.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "자료 삭제", exact: true }).click();
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "수정된 안내", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "자료 삭제", exact: true }).click();
  await page.getByRole("button", { name: "삭제 확인", exact: true }).click();
  await expect(page).toHaveURL(/\/sources$/);
  await expect(
    page.getByRole("link", { name: "수정된 안내 상세 보기" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "수업 메모 상세 보기" }),
  ).toBeVisible();
});

test("text edit preserves newlines, clears title and rejects whitespace", async ({
  page,
}) => {
  await login(page);
  await page.goto("/sources/text-source");
  await page.getByRole("button", { name: "자료 수정", exact: true }).click();
  await page.getByLabel("자료 제목 (선택)").fill("");
  await page.getByLabel("원본 텍스트", { exact: true }).fill("   ");
  await page.getByRole("button", { name: "변경 사항 저장" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "원본 내용을 입력해 주세요." }),
  ).toBeVisible();
  const content = "  첫 줄의 공백 유지\n두 번째 줄\n";
  await page.getByLabel("원본 텍스트", { exact: true }).fill(content);
  await page.screenshot({
    path: test.info().outputPath("source-edit.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  const update = page.waitForRequest((request) => request.method() === "PATCH");
  await page.getByRole("button", { name: "변경 사항 저장" }).click();
  expect((await update).postDataJSON()).toEqual({
    title: null,
    original_text: content,
  });
  await expect(page.getByText("변경 사항을 저장했습니다.")).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "제목 없는 자료", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "자료 수정", exact: true }).click();
  await expect(page.getByLabel("원본 텍스트", { exact: true })).toHaveValue(
    content,
  );
});

test("save and delete errors preserve source and allow retry", async ({
  page,
}) => {
  await login(page);
  await page.goto("/sources/url-source");
  await page.getByRole("button", { name: "자료 수정", exact: true }).click();
  await page
    .getByLabel("원본 URL", { exact: true })
    .fill("javascript:alert(1)");
  await page.getByRole("button", { name: "변경 사항 저장" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "http 또는 https" }),
  ).toBeVisible();
  await page
    .getByLabel("원본 URL", { exact: true })
    .fill("https://example.com/retry");
  await page.getByLabel("자료 제목 (선택)").fill("입력 유지 확인");
  await page.route("**/test-api/api/sources/url-source", (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({ status: 422, json: { detail: "수정 요청 오류" } })
      : route.fallback(),
  );
  await page.getByRole("button", { name: "변경 사항 저장" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "수정 요청 오류" }),
  ).toBeVisible();
  await expect(page.getByLabel("자료 제목 (선택)")).toHaveValue(
    "입력 유지 확인",
  );
  await page.unroute("**/test-api/api/sources/url-source");
  await page.getByRole("button", { name: "변경 사항 저장" }).click();
  await expect(page.getByText("변경 사항을 저장했습니다.")).toBeVisible();
  await page.route("**/test-api/api/sources/url-source", (route) =>
    route.request().method() === "DELETE"
      ? route.fulfill({ status: 500, json: { detail: "삭제 요청 오류" } })
      : route.fallback(),
  );
  await page.getByRole("button", { name: "자료 삭제", exact: true }).click();
  await page.getByRole("button", { name: "삭제 확인", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "삭제 요청 오류" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/sources\/url-source$/);
  await page.unroute("**/test-api/api/sources/url-source");
  await page.getByRole("button", { name: "삭제 확인", exact: true }).click();
  await expect(page).toHaveURL(/\/sources$/);
});

test("source detail protection, loading, missing source and expired session", async ({
  page,
}) => {
  await page.goto("/sources/url-source");
  await expect(page).toHaveURL(/\/login$/);
  await login(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/test-api/api/sources/missing", async (route) => {
    await pending;
    await route.fulfill({ status: 404, json: { detail: "Source not found" } });
  });
  await page.goto("/sources/missing");
  try {
    await expect(
      page.getByText("불러오는 중입니다…", { exact: true }),
    ).toBeVisible();
  } finally {
    release();
  }
  await expect(
    page.getByRole("alert").filter({ hasText: "자료를 찾을 수 없습니다." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "자료 수정", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "← 원본 자료 목록" }).click();
  await page.route("**/test-api/api/sources/url-source", (route) =>
    route.fulfill({ status: 401, json: { detail: "Unauthorized" } }),
  );
  await page.goto("/sources/url-source");
  await expect(page).toHaveURL(/\/login$/);
  expect(
    await page.evaluate(() => sessionStorage.getItem("plancatch.access_token")),
  ).toBeNull();
});
