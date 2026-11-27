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
  await page
    .getByRole("tab", { name: "직접 일정 만들기", exact: true })
    .click();
  const card = page.locator(".manual-registration-card");
  expect(
    Math.abs((await card.boundingBox())!.width - width),
  ).toBeLessThanOrEqual(1);
  const kind = page.getByRole("group", { name: "등록 종류" });
  await expect(
    kind.getByRole("button", { name: "할 일", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const intro = await card
    .getByRole("tablist", { name: "직접 입력 방식" })
    .boundingBox();
  const menu = await kind.boundingBox(),
    title = await page.getByLabel("일정명", { exact: true }).boundingBox();
  expect(menu!.y).toBeGreaterThan(intro!.y + intro!.height);
  expect(menu!.y + menu!.height).toBeLessThan(title!.y);
  await page.getByLabel("일정명", { exact: true }).fill("[테스트] 종류 전환");
  const start = page.getByLabel("시작 일시", { exact: true });
  const end = page.getByLabel("종료 일시", { exact: true });
  const minutes = page.getByLabel("예상 소요시간 (분, 필수)", { exact: true });
  await start.fill("2026-11-06T09:00");
  await expect(end).toHaveValue("2026-11-06T10:00");
  await page.getByLabel("시간 나중에 정하기").check();
  await minutes.fill("90");
  await page.getByLabel("시간 나중에 정하기").uncheck();
  await expect(end).toHaveValue("2026-11-06T10:30");
  await start.fill("2026-11-06T23:30");
  await expect(end).toHaveValue("2026-11-07T01:00");
  await page.getByLabel("시간 나중에 정하기").check();
  await minutes.fill("");
  await page.getByLabel("시간 나중에 정하기").uncheck();
  await expect(end).toHaveValue("2026-11-07T00:30");
  await start.fill("2026-11-06T09:00");
  await page.getByLabel("시간 나중에 정하기").check();
  await minutes.fill("60");
  await page.getByLabel("시간 나중에 정하기").uncheck();
  await page.getByLabel("메모 (선택)", { exact: true }).fill("유지할 메모");
  await page.screenshot({
    path: test.info().outputPath("manual-task-wide.png"),
    fullPage: true,
  });
  await kind.getByRole("button", { name: "마감일", exact: true }).click();
  await expect(page.getByLabel("시작 일시", { exact: true })).toHaveCount(0);
  await expect(
    page.getByLabel("예상 소요시간 (분, 필수)", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("마감 일시", { exact: true })).toHaveValue(
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
  await page.getByLabel("시간 나중에 정하기").check();
  await expect(minutes).toHaveValue("60");
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
  await page.getByLabel("마감 일시", { exact: true }).fill("2026-11-06T23:59");
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
    google_reminders: { mode: "none", overrides: [] },
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
  await page.getByRole("button", { name: "월간", exact: true }).click();
  await expect(page.locator(".bar-deadline")).toHaveText(
    "[테스트] 제안서 마감",
  );
});

test("deadline requires an end time but ignores hidden task fields and failed deadline choices", async ({
  page,
}) => {
  await page.goto("/sources/new?mode=manual");
  await page.getByLabel("일정명", { exact: true }).fill("[테스트] 종료만 필요");
  await page.getByLabel("시간 나중에 정하기").check();
  await page.getByLabel("예상 소요시간 (분, 필수)", { exact: true }).fill("-1");
  await page.getByRole("button", { name: "마감일", exact: true }).click();
  await page.getByRole("button", { name: "마감일 등록", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "마감 일시를 입력해 주세요",
  );
  await page.getByLabel("마감 일시", { exact: true }).fill("2026-11-06T10:00");
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
  await page.getByLabel("마감 일시", { exact: true }).fill("2026-11-06T10:00");
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
      page.getByRole("tab", { name: "자료에서 자동 찾기", exact: true }),
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
  await page.getByLabel("마감 일시", { exact: true }).fill("2026-11-06T10:00");
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
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("link", { name: "+ 새 일정 등록하기", exact: true })
      .click();
    await expect(page).toHaveURL(/\/sources\/new\?new=.+$/);
    await page.getByLabel("일정 제목 (선택)").fill("[테스트] 새 입력 유지");
    const fresh = page.url();
    const response = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" && r.url().endsWith("/api/deadlines"),
    );
    release();
    await (await response).finished();
    await expect(page).toHaveURL(fresh);
    await page
      .getByRole("tab", { name: "직접 일정 만들기", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "할 일", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  } finally {
    release();
  }
});

test("manual deadline safety is visible, keeps kind-switch drafts and submits the combined buffer", async ({
  page,
}) => {
  await page.goto("/sources/new?mode=manual");
  await expect(
    page.getByLabel("안전 마감일 사용", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "마감일", exact: true }).click();
  const enabled = page.getByLabel("안전 마감일 사용", { exact: true });
  await expect(enabled).not.toBeChecked();
  const label = page.locator(".safety-settings .checkbox");
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (value) => (document.documentElement.dataset.theme = value),
      theme,
    );
    await expect(label).toHaveCSS("font-weight", "700");
    await expect(label).toHaveCSS("font-size", "16px");
    await expect(label).toHaveCSS("align-items", "center");
  }
  await enabled.check();
  await page.getByLabel("여유시간 (일)", { exact: true }).fill("1");
  await page.getByLabel("여유시간 (시간)", { exact: true }).fill("3");
  await page.getByLabel("여유시간 (분)", { exact: true }).fill("20");
  await page.getByRole("button", { name: "할 일", exact: true }).click();
  await expect(enabled).toHaveCount(0);
  await page.getByRole("button", { name: "마감일", exact: true }).click();
  await expect(enabled).toBeChecked();
  await expect(page.getByLabel("여유시간 (일)", { exact: true })).toHaveValue(
    "1",
  );
  await page
    .getByLabel("일정명", { exact: true })
    .fill("[테스트] 최초 안전 마감");
  await page.getByLabel("마감 일시", { exact: true }).fill("2026-12-10T18:00");
  await page.screenshot({
    path: test.info().outputPath("manual-safety-dark.png"),
    fullPage: true,
  });
  const sent = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/api/deadlines"),
  );
  await page.getByRole("button", { name: "마감일 등록", exact: true }).click();
  expect((await sent).postDataJSON()).toMatchObject({
    safety_buffer_minutes: 1640,
    due_at: "2026-12-10T09:00:00.000Z",
  });
  await expect(page).toHaveURL(/\/deadlines\/deadline-1$/);
});

test("manual safety rejects invalid totals, accepts maximum and disabling clears the payload after failure", async ({
  page,
}) => {
  await page.goto("/sources/new?mode=manual");
  await page.getByRole("button", { name: "마감일", exact: true }).click();
  await page
    .getByLabel("일정명", { exact: true })
    .fill("[테스트] 안전 마감 검증");
  await page.getByLabel("마감 일시", { exact: true }).fill("2026-12-10T18:00");
  const enabled = page.getByLabel("안전 마감일 사용", { exact: true });
  await enabled.check();
  let writes = 0;
  const payloads: Array<{ safety_buffer_minutes: number | null }> = [];
  await page.route("**/test-api/api/deadlines", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    writes++;
    payloads.push(route.request().postDataJSON());
    if (writes === 1)
      return route.fulfill({
        status: 503,
        json: { detail: "[테스트] 저장 실패" },
      });
    return route.fallback();
  });
  const minutes = page.getByLabel("여유시간 (분)", { exact: true });
  for (const value of [
    "",
    "0",
    "-1",
    "1.5",
    "2147483648",
    "9007199254740992",
  ]) {
    await minutes.fill(value);
    await page
      .getByRole("button", { name: "마감일 등록", exact: true })
      .click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "여유시간",
    );
    expect(writes).toBe(0);
    await expect(minutes).toHaveValue(value);
  }
  await minutes.fill("2147483647");
  await page.getByRole("button", { name: "마감일 등록", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "저장 실패",
  );
  expect(payloads[0].safety_buffer_minutes).toBe(2147483647);
  await expect(minutes).toHaveValue("2147483647");
  await enabled.uncheck();
  await page.getByRole("button", { name: "마감일 등록", exact: true }).click();
  await expect(page).toHaveURL(/\/deadlines\/deadline-1$/);
  expect(payloads[1].safety_buffer_minutes).toBeNull();
});
