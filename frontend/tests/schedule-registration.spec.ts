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
    page.getByRole("button", { name: "이미지 파일 선택" }),
  ).toHaveCount(0);
  const main = page.getByRole("main");
  await expect(
    main.getByRole("link", { name: "자료 등록하기 ↗", exact: true }),
  ).toHaveCount(0);
  const entry = main.getByRole("link", {
    name: "새 일정 등록하기 ↗",
    exact: true,
  });
  await expect(entry).toHaveCount(1);
  await expect(entry).toHaveAttribute("href", "/sources/new");
  await entry.click();
  await expect(page).toHaveURL(/\/sources\/new\?new=.+$/);
  await expect(
    page.getByRole("heading", { name: "새 일정 등록", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "이미지 파일 선택" }),
  ).toBeEnabled();
  await expect(page.getByLabel("원본 URL", { exact: true })).toBeVisible();
  await expect(page.getByLabel("원본 텍스트", { exact: true })).toBeVisible();
  await expect(page.getByText("이미지 지원", { exact: true })).toBeVisible();
  const drop = await page
    .getByRole("button", { name: "이미지 파일 선택" })
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

test("image selection stays local until save; PDF and mixed inputs are rejected", async ({
  page,
}) => {
  await login(page);
  await page.goto("/sources/new");
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });
  const picker = page.getByLabel("이미지 파일 입력", { exact: true });
  await picker.setInputFiles({
    name: "공지.png",
    mimeType: "image/png",
    buffer: Buffer.from("synthetic image"),
  });
  const files = page.getByRole("list", { name: "선택한 파일" });
  await expect(files.getByRole("listitem")).toHaveCount(1);
  await expect(files).toContainText("미업로드");
  expect(posts).toHaveLength(0);
  await picker.setInputFiles({
    name: "공지.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4"),
  });
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "HEIC·SVG·PDF는 아직 지원하지 않습니다",
  );
  await expect(files.getByRole("listitem")).toHaveCount(1);
  await page
    .getByLabel("원본 URL", { exact: true })
    .fill("https://example.com/notice");
  await page.getByRole("button", { name: "자료 저장", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert").last()).toContainText(
    "하나만 등록",
  );
  expect(posts).toHaveLength(0);
  await page.getByRole("button", { name: "공지.png 제거" }).click();
  const sent = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().endsWith("/api/sources"),
  );
  await page.getByRole("button", { name: "자료 저장", exact: true }).click();
  expect((await sent).postDataJSON()).toEqual({
    source_type: "url",
    original_url: "https://example.com/notice",
  });
  await expect(page).toHaveURL(/\/sources\/source-1\/review$/);
});

test("file drop deduplicates files and reload does not persist local selections", async ({
  page,
}) => {
  await login(page);
  await page.goto("/sources/new");
  const drop = page.getByRole("button", { name: "이미지 파일 선택" });
  const dataTransfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(
      new File(["synthetic PNG"], "드래그-테스트.png", {
        type: "image/png",
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

test("PNG aliases and convertible formats remain selectable until server validation", async ({
  page,
}) => {
  await login(page);
  await page.goto("/sources/new");
  const picker = page.getByLabel("이미지 파일 입력", { exact: true });
  const files = page.getByRole("list", { name: "선택한 파일" });
  const uploads: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") uploads.push(request.url());
  });
  for (const [name, mimeType] of [
    ["화면.PNG", "image/x-png"],
    ["다른표기.png", "application/octet-stream"],
    ["빈형식.png", ""],
    ["사진.jpeg", "image/pjpeg"],
    ["공지.webp", "image/webp"],
    ["공지.bmp", "image/bmp"],
    ["공지.gif", "image/gif"],
    ["공지.tif", "image/tiff"],
    ["공지.tiff", "image/tiff"],
    ["공지.avif", "image/avif"],
  ]) {
    await picker.setInputFiles({
      name,
      mimeType,
      buffer: Buffer.from("server decodes real bytes"),
    });
    await expect(files).toContainText(name);
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  }
  expect(uploads).toHaveLength(0);
  for (const ext of ["heic", "svg", "pdf"]) {
    await picker.setInputFiles({
      name: "미지원." + ext,
      mimeType: "",
      buffer: Buffer.from("unsupported"),
    });
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "HEIC·SVG·PDF는 아직 지원하지 않습니다",
    );
    await expect(files).toContainText("공지.avif");
  }
  await expect(picker).toHaveAttribute(
    "accept",
    /\.png.*\.webp.*\.bmp.*\.gif.*\.tiff.*\.avif/,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
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
      page.getByRole("button", { name: "이미지 파일 선택" }),
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
  await expect(page).toHaveURL(/\/sources\/source-1\/review$/);
});

test("direct registration access still requires login", async ({ page }) => {
  await page.goto("/sources/new");
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("button", { name: "이미지 파일 선택" }),
  ).toHaveCount(0);
});

test("a late save response cannot navigate away from a fresh registration", async ({
  page,
}) => {
  await login(page);
  await page.goto("/sources/new");
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/test-api/api/sources", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON();
    await pending;
    await route.fulfill({ status: 201, json: { id: "late-source", ...body } });
  });
  await page
    .getByLabel("원본 URL", { exact: true })
    .fill("https://example.com/old");
  const sent = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().endsWith("/api/sources"),
  );
  await page.getByRole("button", { name: "자료 저장", exact: true }).click();
  await sent;
  try {
    await page
      .getByRole("link", { name: "새 일정 등록하기", exact: true })
      .click();
    await expect(page.getByLabel("원본 URL", { exact: true })).toHaveValue("");
    await page.getByLabel("자료 제목 (선택)").fill("유지할 새 입력");
    const freshUrl = page.url();
    const response = page.waitForResponse(
      (reply) =>
        reply.request().method() === "POST" &&
        reply.url().endsWith("/api/sources"),
    );
    release();
    await (await response).finished();
    // Observe the unwanted navigation event, rather than asserting before the
    // old request's continuation has had a chance to run.
    const staleNavigation = await page
      .waitForURL(/\/sources$/, { timeout: 1500 })
      .then(
        () => true,
        () => false,
      );
    expect(staleNavigation).toBe(false);
    await expect(page).toHaveURL(freshUrl);
    await expect(page.getByLabel("자료 제목 (선택)")).toHaveValue(
      "유지할 새 입력",
    );
  } finally {
    release();
  }
});
