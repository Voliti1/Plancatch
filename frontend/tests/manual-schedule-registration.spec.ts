import { test, expect } from "@playwright/test";
import { login, mockApi } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test("a late manual save cannot navigate away from a fresh registration", async ({
  page,
}) => {
  await login(page);
  await page.goto("/sources/new?mode=manual");
  await page
    .getByLabel("작업명", { exact: true })
    .fill("[테스트] 이전 수동 등록");
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/test-api/api/tasks", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON();
    await pending;
    await route.fulfill({ status: 201, json: { id: "late-task", ...body } });
  });
  const sent = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().endsWith("/api/tasks"),
  );
  await page
    .getByRole("button", { name: "수동 일정 등록", exact: true })
    .click();
  await sent;
  try {
    await page
      .getByRole("link", { name: "새 일정 등록하기", exact: true })
      .click();
    await page.getByLabel("자료 제목 (선택)").fill("[테스트] 유지할 새 입력");
    const fresh = page.url();
    const response = page.waitForResponse(
      (reply) =>
        reply.request().method() === "POST" &&
        reply.url().endsWith("/api/tasks"),
    );
    release();
    await (await response).finished();
    const stale = await page
      .waitForURL(/\/tasks\/late-task$/, { timeout: 1500 })
      .then(
        () => true,
        () => false,
      );
    expect(stale).toBe(false);
    await expect(page).toHaveURL(fresh);
    await expect(page.getByLabel("자료 제목 (선택)")).toHaveValue(
      "[테스트] 유지할 새 입력",
    );
  } finally {
    release();
  }
});

test("manual registration replaces the sidebar task entry and saves through the existing task API", async ({
  page,
}) => {
  await login(page);
  await expect(
    page
      .getByRole("navigation", { name: "주 메뉴" })
      .getByRole("link", { name: "작업", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("link", { name: "새 일정 등록하기", exact: true })
    .click();
  await page.getByRole("tab", { name: "수동 일정 등록", exact: true }).click();
  await expect(page.getByLabel("작업명", { exact: true })).toBeEnabled();
  await page
    .getByRole("link", { name: "등록한 일정 보기 →", exact: true })
    .click();
  await expect(page).toHaveURL(/\/tasks$/);
  await page
    .getByRole("link", { name: "＋ 수동 일정 등록", exact: true })
    .click();
  await expect(page).toHaveURL(/\/sources\/new\?mode=manual&new=.+$/);
  await expect(
    page.getByRole("tab", { name: "수동 일정 등록", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page
    .getByLabel("작업명", { exact: true })
    .fill("[테스트] 직접 등록한 발표 준비");
  await page.getByLabel("작업 유형", { exact: true }).selectOption("fixed");
  await page.getByLabel("예상 소요시간 (분, 선택)").fill("60");
  await page
    .getByLabel("가능 시작 일시 (한국 시간, 선택)")
    .fill("2026-11-06T09:00");
  await page
    .getByLabel("최종 완료 일시 (한국 시간, 선택)")
    .fill("2026-11-06T10:00");
  await page.screenshot({
    path: test.info().outputPath("manual-schedule-registration.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  const sent = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().endsWith("/api/tasks"),
  );
  await page
    .getByRole("button", { name: "수동 일정 등록", exact: true })
    .click();
  expect((await sent).postDataJSON()).toEqual({
    title: "[테스트] 직접 등록한 발표 준비",
    deadline_id: null,
    description: null,
    estimated_minutes: 60,
    priority: 3,
    schedule_type: "fixed",
    earliest_start: "2026-11-06T00:00:00.000Z",
    latest_end: "2026-11-06T01:00:00.000Z",
    is_completed: false,
  });
  await expect(page).toHaveURL(/\/tasks\/task-1$/);
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "[테스트] 직접 등록한 발표 준비",
      exact: true,
    }),
  ).toBeVisible();
});

test("registration modes preserve both drafts and new registration clears them", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("link", { name: "새 일정 등록하기 ↗", exact: true })
    .click();
  await page
    .getByLabel("원본 텍스트", { exact: true })
    .fill("[테스트] 자료 입력 초안");
  await page.getByLabel("PDF·JPG 파일 입력", { exact: true }).setInputFiles({
    name: "[테스트] 자료.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 test-only"),
  });
  await page
    .getByRole("tab", { name: "자료로 등록", exact: true })
    .press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "수동 일정 등록", exact: true }),
  ).toBeFocused();
  await page
    .getByLabel("작업명", { exact: true })
    .fill("[테스트] 수동 입력 초안");
  await page
    .getByRole("tab", { name: "수동 일정 등록", exact: true })
    .press("ArrowLeft");
  await expect(page.getByLabel("원본 텍스트", { exact: true })).toHaveValue(
    "[테스트] 자료 입력 초안",
  );
  await expect(
    page.getByRole("list", { name: "선택한 파일" }).getByRole("listitem"),
  ).toHaveCount(1);
  await page.getByRole("tab", { name: "수동 일정 등록", exact: true }).click();
  await expect(page.getByLabel("작업명", { exact: true })).toHaveValue(
    "[테스트] 수동 입력 초안",
  );
  await page
    .getByRole("link", { name: "새 일정 등록하기", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "자료로 등록", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("원본 텍스트", { exact: true })).toHaveValue("");
  await expect(page.getByRole("list", { name: "선택한 파일" })).toHaveCount(0);
  await page.getByRole("tab", { name: "수동 일정 등록", exact: true }).click();
  await expect(page.getByLabel("작업명", { exact: true })).toHaveValue("");
});

test("manual save errors keep the draft and lock mode changes until the request settles", async ({
  page,
}) => {
  await login(page);
  await page.goto("/sources/new?mode=manual");
  await page.getByLabel("작업명", { exact: true }).fill("[테스트] 재시도 일정");
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let attempts = 0;
  await page.route("**/test-api/api/tasks", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    attempts++;
    await pending;
    await route.fulfill({
      status: 503,
      json: { detail: "[테스트] 수동 등록 실패" },
    });
  });
  await page
    .getByRole("button", { name: "수동 일정 등록", exact: true })
    .click();
  try {
    await expect(
      page.getByRole("tab", { name: "자료로 등록", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("tab", { name: "수동 일정 등록", exact: true }),
    ).toBeDisabled();
    await expect(page.getByRole("button", { name: "저장 중…" })).toBeDisabled();
    expect(attempts).toBe(1);
  } finally {
    release();
  }
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "[테스트] 수동 등록 실패",
  );
  await expect(page.getByLabel("작업명", { exact: true })).toHaveValue(
    "[테스트] 재시도 일정",
  );
  await expect(
    page.getByRole("tab", { name: "자료로 등록", exact: true }),
  ).toBeEnabled();
  await page.unroute("**/test-api/api/tasks");
  await page
    .getByRole("button", { name: "수동 일정 등록", exact: true })
    .click();
  await expect(page).toHaveURL(/\/tasks\/task-1$/);
});
