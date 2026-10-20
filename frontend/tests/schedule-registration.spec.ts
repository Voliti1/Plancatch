import { test, expect } from "@playwright/test";
import { login, mockApi } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test("dashboard opens the separate registration screen with responsive inputs", async ({
  page,
}) => {
  await login(page);
  await expect(
    page.getByRole("button", { name: "PDF·JPG 파일 선택" }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "자료 등록하기 ↗", exact: true }).click();
  await expect(page).toHaveURL(/\/sources\/new$/);
  await expect(
    page.getByRole("heading", { name: "새 일정 등록", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "PDF·JPG 파일 선택" }),
  ).toBeEnabled();
  await expect(page.getByLabel("원본 URL", { exact: true })).toBeVisible();
  await expect(page.getByLabel("원본 텍스트", { exact: true })).toBeVisible();
  await expect(page.getByText("업로드 준비 중", { exact: true })).toBeVisible();
  const drop = await page
    .getByRole("button", { name: "PDF·JPG 파일 선택" })
    .boundingBox();
  const url = await page.getByLabel("원본 URL", { exact: true }).boundingBox();
  expect(drop).not.toBeNull();
  expect(url).not.toBeNull();
  if (page.viewportSize()!.width > 1000)
    expect(url!.x).toBeGreaterThan(drop!.x + drop!.width);
  else expect(url!.y).toBeGreaterThan(drop!.y + drop!.height);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: test.info().outputPath("schedule-registration.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "← 대시보드" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("PDF and JPG selection stays local and cannot be mistaken for an upload", async ({
  page,
}) => {
  await login(page);
  await page.goto("/sources/new");
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });
  const drop = page.getByRole("button", { name: "PDF·JPG 파일 선택" });
  const chooserPromise = page.waitForEvent("filechooser");
  await drop.click();
  await (
    await chooserPromise
  ).setFiles([
    {
      name: "테스트-공지.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 test-only"),
    },
    {
      name: "테스트-공지.jpeg",
      mimeType: "image/jpeg",
      buffer: Buffer.from([255, 216, 255, 217]),
    },
  ]);
  const files = page.getByRole("list", { name: "선택한 파일" });
  await expect(files.getByRole("listitem")).toHaveCount(2);
  await expect(files.getByText("미업로드", { exact: false })).toHaveCount(2);
  await page
    .getByLabel("원본 URL", { exact: true })
    .fill("https://example.com/notice");
  await expect(
    page.getByRole("button", { name: "자료 저장", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("파일 업로드는 아직 지원하지 않습니다.", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("PDF·JPG 파일 입력", { exact: true }).setInputFiles([
    {
      name: "지원하지않음.png",
      mimeType: "image/png",
      buffer: Buffer.from("test-only"),
    },
    {
      name: "형식불일치.jpg",
      mimeType: "application/pdf",
      buffer: Buffer.from("test-only"),
    },
  ]);
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "PDF 또는 JPG 파일만 선택할 수 있어요",
  );
  await expect(files.getByRole("listitem")).toHaveCount(2);
  expect(posts).toHaveLength(0);
  await page.getByRole("button", { name: "테스트-공지.pdf 제거" }).click();
  await page.getByRole("button", { name: "테스트-공지.jpeg 제거" }).click();
  await expect(
    page.getByRole("button", { name: "자료 저장", exact: true }),
  ).toBeEnabled();
  const sent = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().endsWith("/api/sources"),
  );
  await page.getByRole("button", { name: "자료 저장", exact: true }).click();
  expect((await sent).postDataJSON()).toEqual({
    source_type: "url",
    original_url: "https://example.com/notice",
  });
  await expect(page).toHaveURL(/\/sources$/);
});

test("file drop deduplicates files and reload does not persist local selections", async ({
  page,
}) => {
  await login(page);
  await page.goto("/sources/new");
  const drop = page.getByRole("button", { name: "PDF·JPG 파일 선택" });
  const dataTransfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(
      new File(["%PDF-1.4 test-only"], "드래그-테스트.pdf", {
        type: "application/pdf",
        lastModified: 1,
      }),
    );
    return data;
  });
  await drop.dispatchEvent("dragenter", { dataTransfer });
  await expect(drop).toHaveClass(/is-dragging/);
  await drop.dispatchEvent("drop", { dataTransfer });
  await expect(drop).not.toHaveClass(/is-dragging/);
  await drop.dispatchEvent("drop", { dataTransfer });
  await expect(
    page.getByRole("list", { name: "선택한 파일" }).getByRole("listitem"),
  ).toHaveCount(1);
  await page.reload();
  await expect(
    page.getByText("선택한 파일이 없습니다.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("list", { name: "선택한 파일" })).toHaveCount(0);
});

test("empty, invalid and ambiguous input never posts or clears the draft", async ({
  page,
}) => {
  await login(page);
  await page.goto("/sources/new");
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });
  await page.getByRole("button", { name: "자료 저장", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "URL 또는 텍스트를 입력해 주세요.",
  );
  await page
    .getByLabel("원본 URL", { exact: true })
    .fill("javascript:alert(1)");
  await page.getByRole("button", { name: "자료 저장", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "올바른 URL",
  );
  await page
    .getByLabel("원본 URL", { exact: true })
    .fill("https://example.com/notice");
  await page.getByLabel("원본 텍스트", { exact: true }).fill("테스트 공지");
  await page.getByRole("button", { name: "자료 저장", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "하나만 입력해 주세요.",
  );
  await expect(page.getByLabel("원본 URL", { exact: true })).toHaveValue(
    "https://example.com/notice",
  );
  await expect(page.getByLabel("원본 텍스트", { exact: true })).toHaveValue(
    "테스트 공지",
  );
  expect(posts).toHaveLength(0);
});

test("failed save preserves draft; retry posts the existing contract exactly once", async ({
  page,
}) => {
  await login(page);
  await page.goto("/sources/new");
  await page.getByLabel("자료 제목 (선택)").fill("테스트 자료");
  const text = "  테스트 첫 줄\n둘째 줄\n";
  await page.getByLabel("원본 텍스트", { exact: true }).fill(text);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let failedRequests = 0;
  await page.route("**/test-api/api/sources", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    failedRequests++;
    await pending;
    await route.fulfill({ status: 503, json: { detail: "테스트 저장 실패" } });
  });
  await page.getByRole("button", { name: "자료 저장", exact: true }).click();
  try {
    await expect(page.getByRole("button", { name: "저장 중…" })).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "PDF·JPG 파일 선택" }),
    ).toBeDisabled();
    await expect(
      page.getByLabel("원본 텍스트", { exact: true }),
    ).toBeDisabled();
    expect(failedRequests).toBe(1);
  } finally {
    release();
  }
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "테스트 저장 실패",
  );
  await expect(page.getByLabel("원본 텍스트", { exact: true })).toHaveValue(
    text,
  );
  await expect(page.getByLabel("자료 제목 (선택)")).toHaveValue("테스트 자료");
  await page.unroute("**/test-api/api/sources");
  const sent = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().endsWith("/api/sources"),
  );
  await page.getByRole("button", { name: "자료 저장", exact: true }).click();
  expect((await sent).postDataJSON()).toEqual({
    source_type: "text",
    title: "테스트 자료",
    original_text: text,
  });
  await expect(page).toHaveURL(/\/sources$/);
});

test("direct registration access still requires login", async ({ page }) => {
  await page.goto("/sources/new");
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("button", { name: "PDF·JPG 파일 선택" }),
  ).toHaveCount(0);
});
