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
    .getByLabel("일정명", { exact: true })
    .fill("[테스트] 이전 수동 등록");
  await page.getByLabel("시작 일시", { exact: true }).fill("2026-11-06T09:00");
  await page.getByLabel("종료 일시", { exact: true }).fill("2026-11-06T10:00");
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
  await page.getByRole("button", { name: "일정 등록", exact: true }).click();
  await sent;
  try {
    await page
      .getByRole("link", { name: "새 일정 등록하기", exact: true })
      .click();
    await page.getByLabel("일정 제목 (선택)").fill("[테스트] 유지할 새 입력");
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
    await expect(page.getByLabel("일정 제목 (선택)")).toHaveValue(
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
  await expect(page.getByLabel("일정명", { exact: true })).toBeEnabled();
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
    .getByLabel("일정명", { exact: true })
    .fill("[테스트] 직접 등록한 발표 준비");
  await expect(page.getByLabel("작업 유형", { exact: true })).toBeHidden();
  await expect(page.getByLabel("연결할 마감일", { exact: true })).toBeHidden();
  await page.getByLabel("시작 일시", { exact: true }).fill("2026-11-06T09:00");
  await page.getByLabel("종료 일시", { exact: true }).fill("2026-11-06T10:00");
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
  await page.getByRole("button", { name: "일정 등록", exact: true }).click();
  expect((await sent).postDataJSON()).toEqual({
    title: "[테스트] 직접 등록한 발표 준비",
    deadline_id: null,
    description: null,
    estimated_minutes: null,
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
  await page.getByLabel("이미지 파일 입력", { exact: true }).setInputFiles({
    name: "[테스트] 자료.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await page
    .getByRole("tab", { name: "자료로 등록", exact: true })
    .press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "수동 일정 등록", exact: true }),
  ).toBeFocused();
  await page
    .getByLabel("일정명", { exact: true })
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
  await expect(page.getByLabel("일정명", { exact: true })).toHaveValue(
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
  await expect(page.getByLabel("일정명", { exact: true })).toHaveValue("");
});

test("manual save errors keep the draft and lock mode changes until the request settles", async ({
  page,
}) => {
  await login(page);
  await page.goto("/sources/new?mode=manual");
  await page.getByLabel("일정명", { exact: true }).fill("[테스트] 재시도 일정");
  await page.getByLabel("시작 일시", { exact: true }).fill("2026-11-06T09:00");
  await page.getByLabel("종료 일시", { exact: true }).fill("2026-11-06T10:00");
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
  await page.getByRole("button", { name: "일정 등록", exact: true }).click();
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
  await expect(page.getByLabel("일정명", { exact: true })).toHaveValue(
    "[테스트] 재시도 일정",
  );
  await expect(
    page.getByRole("tab", { name: "자료로 등록", exact: true }),
  ).toBeEnabled();
  await page.unroute("**/test-api/api/tasks");
  await page.getByRole("button", { name: "일정 등록", exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\/task-1$/);
});

test("simple registration requires a name and valid time range before calling the API", async ({
  page,
}) => {
  await login(page);
  await page.goto("/sources/new?mode=manual");
  let saves = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/tasks"))
      saves++;
  });
  const save = page.getByRole("button", { name: "일정 등록", exact: true });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "일정명을 입력해 주세요.",
  );
  await page.getByLabel("일정명", { exact: true }).fill("[테스트] 시간 확인");
  await save.click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "시작 일시와 종료 일시를 입력해 주세요.",
  );
  await page.getByLabel("시작 일시", { exact: true }).fill("2026-11-06T10:00");
  await page.getByLabel("종료 일시", { exact: true }).fill("2026-11-06T10:00");
  await save.click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "종료 일시는 시작 일시보다 늦게 설정해 주세요.",
  );
  expect(saves).toBe(0);
  await page.getByLabel("종료 일시", { exact: true }).fill("2026-11-06T11:00");
  await save.click();
  await expect(page).toHaveURL(/\/tasks\/task-1$/);
  expect(saves).toBe(1);
});

test("collapsed settings and memo keep their values across mode changes and save with Seoul dates", async ({
  page,
}) => {
  await mockApi(page, [], {
    deadlines: [
      {
        id: "deadline-1",
        title: "[테스트] 발표 마감",
        due_at: "2027-01-05T00:00:00Z",
        source_id: null,
        deadline_type: null,
        description: null,
        is_confirmed: true,
        safety_buffer_minutes: null,
        safe_due_at: null,
        confidence: null,
        evidence_text: null,
        created_at: "2026-10-20T00:00:00Z",
        updated_at: "2026-10-20T00:00:00Z",
      },
    ],
  });
  await login(page);
  await page.goto("/sources/new?mode=manual&deadline_id=deadline-1");
  await page.getByLabel("일정명", { exact: true }).fill("[테스트] 밤샘 회의");
  await page.getByLabel("시작 일시", { exact: true }).fill("2026-12-31T23:30");
  await page.getByLabel("종료 일시", { exact: true }).fill("2027-01-01T01:00");
  await page
    .getByLabel("메모 (선택)", { exact: true })
    .fill("  [테스트] 회의실 A  ");
  await page.getByText("상세 설정", { exact: true }).click();
  await expect(page.getByLabel("연결할 마감일", { exact: true })).toHaveValue(
    "deadline-1",
  );
  await expect(page.getByLabel("작업 유형", { exact: true })).toHaveValue(
    "fixed",
  );
  await page.getByLabel("예상 소요시간 (분, 선택)").fill("0");
  await page.getByText("상세 설정", { exact: true }).click();
  await page.getByRole("button", { name: "일정 등록", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "예상 소요시간은 1분 이상의 정수",
  );
  await page.getByText("상세 설정", { exact: true }).click();
  await page.getByLabel("예상 소요시간 (분, 선택)").fill("90");
  await page.getByLabel("우선순위", { exact: true }).selectOption("2");
  await page.getByLabel("작업 유형", { exact: true }).selectOption("flexible");
  await page.getByLabel("완료한 작업으로 표시").check();
  await page.getByText("상세 설정", { exact: true }).click();
  await page.getByRole("tab", { name: "자료로 등록", exact: true }).click();
  await page.getByRole("tab", { name: "수동 일정 등록", exact: true }).click();
  await expect(page.getByLabel("메모 (선택)", { exact: true })).toHaveValue(
    "  [테스트] 회의실 A  ",
  );
  await expect(page.getByLabel("시작 일시", { exact: true })).toHaveValue(
    "2026-12-31T23:30",
  );
  const sent = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().endsWith("/api/tasks"),
  );
  await page.getByRole("button", { name: "일정 등록", exact: true }).click();
  expect((await sent).postDataJSON()).toEqual({
    title: "[테스트] 밤샘 회의",
    description: "[테스트] 회의실 A",
    deadline_id: "deadline-1",
    estimated_minutes: 90,
    priority: 2,
    schedule_type: "flexible",
    is_completed: true,
    earliest_start: "2026-12-31T14:30:00.000Z",
    latest_end: "2026-12-31T16:00:00.000Z",
  });
  await expect(page).toHaveURL(/\/tasks\/task-1$/);
});
