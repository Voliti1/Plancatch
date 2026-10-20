import { test, expect } from "@playwright/test";
import { login, mockApi } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await mockApi(page);
  await login(page);
});

test("manual card matches source width and type buttons sit above the shared title with drafts preserved", async ({
  page,
}) => {
  await page.goto("/sources/new");
  const width = await page
    .locator("form.source-registration")
    .evaluate((e) => e.getBoundingClientRect().width);
  await page.getByRole("tab", { name: "수동 일정 등록", exact: true }).click();
  const card = page.locator(".manual-registration-card");
  expect(
    Math.abs((await card.boundingBox())!.width - width),
  ).toBeLessThanOrEqual(1);
  const kind = page.getByRole("group", { name: "등록 종류" });
  await expect(
    kind.getByRole("button", { name: "할 일", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const intro = await card
    .getByText(
      "일정명과 시간을 입력하세요. 필요한 내용은 나중에 수정할 수 있습니다.",
      { exact: true },
    )
    .boundingBox();
  const menu = await kind.boundingBox(),
    title = await page.getByLabel("일정명", { exact: true }).boundingBox();
  expect(menu!.y).toBeGreaterThan(intro!.y + intro!.height);
  expect(menu!.y + menu!.height).toBeLessThan(title!.y);
  await page.getByLabel("일정명", { exact: true }).fill("[테스트] 종류 전환");
  await page.getByLabel("시작 일시", { exact: true }).fill("2026-11-06T09:00");
  await page.getByLabel("종료 일시", { exact: true }).fill("2026-11-06T10:00");
  await page.getByLabel("메모 (선택)", { exact: true }).fill("유지할 메모");
  await page.getByText("상세 설정", { exact: true }).click();
  await page.getByLabel("예상 소요시간 (분, 선택)", { exact: true }).fill("60");
  await page.screenshot({
    path: test.info().outputPath("manual-task-wide.png"),
    fullPage: true,
  });
  await kind.getByRole("button", { name: "마감일", exact: true }).click();
  await expect(page.getByLabel("시작 일시", { exact: true })).toHaveCount(0);
  await expect(
    page.getByLabel("예상 소요시간 (분, 선택)", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("종료 일시", { exact: true })).toHaveValue(
    "2026-11-06T10:00",
  );
  await expect(page.getByLabel("일정명", { exact: true })).toHaveValue(
    "[테스트] 종류 전환",
  );
  await page.screenshot({
    path: test.info().outputPath("manual-deadline-wide.png"),
    fullPage: true,
  });
  await kind.getByRole("button", { name: "할 일", exact: true }).click();
  await expect(page.getByLabel("시작 일시", { exact: true })).toHaveValue(
    "2026-11-06T09:00",
  );
  await expect(
    page.getByLabel("예상 소요시간 (분, 선택)", { exact: true }),
  ).toHaveValue("60");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("deadline registration sends only the end time to Deadline API and appears in the calendar", async ({
  page,
}) => {
  await page.goto("/sources/new?mode=manual");
  await page.getByRole("button", { name: "마감일", exact: true }).click();
  await page.getByLabel("일정명", { exact: true }).fill("[테스트] 제안서 마감");
  await page.getByLabel("종료 일시", { exact: true }).fill("2026-11-06T23:59");
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/api/"))
      writes.push(new URL(r.url()).pathname);
  });
  const sent = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/api/deadlines"),
  );
  await page.getByRole("button", { name: "마감일 등록", exact: true }).click();
  expect((await sent).postDataJSON()).toEqual({
    title: "[테스트] 제안서 마감",
    due_at: "2026-11-06T14:59:00.000Z",
    description: null,
    source_id: null,
    deadline_type: null,
    safety_buffer_minutes: null,
    is_confirmed: true,
  });
  await expect(page).toHaveURL(/\/deadlines\/deadline-1$/);
  expect(writes).toEqual(["/test-api/api/deadlines"]);
  await page.goto("/calendar?date=2026-11-06");
  await expect(page.locator(".bar-deadline")).toHaveText(
    "[테스트] 제안서 마감",
  );
});

test("deadline requires an end time but ignores hidden task fields and failed deadline choices", async ({
  page,
}) => {
  await page.goto("/sources/new?mode=manual");
  await page.getByLabel("일정명", { exact: true }).fill("[테스트] 종료만 필요");
  await page.getByText("상세 설정", { exact: true }).click();
  await page.getByLabel("예상 소요시간 (분, 선택)", { exact: true }).fill("-1");
  await page.getByRole("button", { name: "마감일", exact: true }).click();
  await page.getByRole("button", { name: "마감일 등록", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "종료 일시를 입력해 주세요",
  );
  await page.getByLabel("종료 일시", { exact: true }).fill("2026-11-06T10:00");
  await page.getByRole("button", { name: "마감일 등록", exact: true }).click();
  await expect(page).toHaveURL(/\/deadlines\/deadline-1$/);
  await page.route("**/test-api/api/deadlines?**", (route) =>
    route.fulfill({ status: 503, json: { detail: "[테스트] 목록 오류" } }),
  );
  await page.goto("/sources/new?mode=manual");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "목록 오류",
  );
  await page.getByRole("button", { name: "마감일", exact: true }).click();
  await expect(page.getByLabel("일정명", { exact: true })).toBeEnabled();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
});

test("pending deadline saves lock type switches and failures preserve inputs", async ({
  page,
}) => {
  await page.goto("/sources/new?mode=manual");
  await page.getByRole("button", { name: "마감일", exact: true }).click();
  await page.getByLabel("일정명", { exact: true }).fill("[테스트] 저장 실패");
  await page.getByLabel("종료 일시", { exact: true }).fill("2026-11-06T10:00");
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/test-api/api/deadlines", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await waiting;
    await route.fulfill({
      status: 503,
      json: { detail: "[테스트] 저장 실패" },
    });
  });
  await page.getByRole("button", { name: "마감일 등록", exact: true }).click();
  try {
    await expect(
      page
        .getByRole("group", { name: "등록 종류" })
        .getByRole("button", { name: "할 일", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("tab", { name: "자료로 등록", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "저장 중…", exact: true }),
    ).toBeDisabled();
  } finally {
    release();
  }
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "[테스트] 저장 실패",
  );
  await expect(page.getByLabel("일정명", { exact: true })).toHaveValue(
    "[테스트] 저장 실패",
  );
  await expect(
    page.getByRole("button", { name: "마감일 등록", exact: true }),
  ).toBeEnabled();
});

test("a late deadline save does not navigate away from a newly opened registration", async ({
  page,
}) => {
  await page.goto("/sources/new?mode=manual");
  await page.getByRole("button", { name: "마감일", exact: true }).click();
  await page.getByLabel("일정명", { exact: true }).fill("[테스트] 이전 마감");
  await page.getByLabel("종료 일시", { exact: true }).fill("2026-11-06T10:00");
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/test-api/api/deadlines", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await waiting;
    await route.fulfill({ status: 201, json: { id: "late-deadline" } });
  });
  const sent = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/api/deadlines"),
  );
  await page.getByRole("button", { name: "마감일 등록", exact: true }).click();
  await sent;
  try {
    await page
      .getByRole("link", { name: "새 일정 등록하기", exact: true })
      .click();
    await expect(page).toHaveURL(/\/sources\/new\?new=.+$/);
    await page.getByLabel("자료 제목 (선택)").fill("[테스트] 새 입력 유지");
    const fresh = page.url();
    const response = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" && r.url().endsWith("/api/deadlines"),
    );
    release();
    await (await response).finished();
    await expect(page).toHaveURL(fresh);
    await page
      .getByRole("tab", { name: "수동 일정 등록", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "할 일", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  } finally {
    release();
  }
});
