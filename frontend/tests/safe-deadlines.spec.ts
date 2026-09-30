import { test, expect, type Page } from "@playwright/test";
import { login, mockApi } from "./fixtures";
import type { Deadline } from "../types/api";

const deadline: Deadline = {
  id: "deadline-1",
  title: "[테스트] 안전 마감 제출",
  due_at: "2026-10-05T09:00:45.123Z",
  safety_buffer_minutes: 1640,
  safe_due_at: "2026-10-04T05:40:45.123Z",
  source_id: "test-source",
  deadline_type: "과제",
  description: "[테스트] 원래 설명",
  confidence: "0.8",
  evidence_text: "[테스트] 원문 근거",
  is_confirmed: true,
  created_at: "2026-09-30T00:00:00Z",
  updated_at: "2026-09-30T00:00:00Z",
};

async function open(page: Page, initial: Deadline[] = [deadline]) {
  await mockApi(page, [], { deadlines: initial });
  await login(page);
  await page.goto("/deadlines");
}

test("creating without safety sends null and a past deadline can be configured with a one-minute buffer", async ({
  page,
}) => {
  await open(page, []);
  await page.getByRole("button", { name: "＋ 마감일 등록" }).click();
  await page.getByLabel("마감 제목").fill("[테스트] 지난 공식 마감");
  await page.getByLabel("마감 일시 (한국 시간)").fill("2020-01-01T09:00");
  const sent = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/api/deadlines"),
  );
  await page.getByRole("button", { name: "마감일 등록", exact: true }).click();
  expect((await sent).postDataJSON().safety_buffer_minutes).toBeNull();
  await expect(page).toHaveURL(/\/deadlines\/deadline-1$/);
  await expect(page.getByLabel("저장된 마감일")).toContainText("미설정");
  await page.getByLabel("안전 마감일 사용", { exact: true }).check();
  await page.getByLabel("여유시간 (분)", { exact: true }).fill("1");
  await page.getByRole("button", { name: "변경 사항 저장" }).click();
  await expect(
    page.getByLabel("저장된 마감일").locator("time").nth(1),
  ).toHaveAttribute("datetime", "2019-12-31T23:59:00.000Z");
  await expect(page.getByLabel("저장된 마감일")).toContainText("1분 전");
  await page.reload();
  await expect(
    page.getByLabel("안전 마감일 사용", { exact: true }),
  ).toBeChecked();
});

test("creation requires explicit buffer, stores day/hour/minute total and displays both server dates", async ({
  page,
}) => {
  await open(page, []);
  await page.getByRole("button", { name: "＋ 마감일 등록" }).click();
  await expect(
    page.getByLabel("안전 마감일 사용", { exact: true }),
  ).not.toBeChecked();
  await expect(page.getByLabel("여유시간 (일)", { exact: true })).toHaveCount(
    0,
  );
  await page.getByLabel("마감 제목").fill(deadline.title);
  await page.getByLabel("마감 일시 (한국 시간)").fill("2026-10-05T18:00");
  await page.getByLabel("안전 마감일 사용", { exact: true }).check();
  await expect(page.getByLabel("여유시간 (일)", { exact: true })).toHaveValue(
    "",
  );
  await page.getByLabel("여유시간 (일)", { exact: true }).fill("1");
  await page.getByLabel("여유시간 (시간)", { exact: true }).fill("3");
  await page.getByLabel("여유시간 (분)", { exact: true }).fill("20");
  const sent = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/api/deadlines"),
  );
  await page.getByRole("button", { name: "마감일 등록", exact: true }).click();
  expect((await sent).postDataJSON()).toMatchObject({
    due_at: "2026-10-05T09:00:00.000Z",
    safety_buffer_minutes: 1640,
  });
  expect((await sent).postDataJSON()).not.toHaveProperty("safe_due_at");
  await expect(page).toHaveURL(/\/deadlines\/deadline-1$/);
  const dates = page.getByLabel("저장된 마감일", { exact: true });
  await expect(dates).toContainText("공식 마감");
  await expect(dates.locator("time").nth(0)).toHaveAttribute(
    "datetime",
    "2026-10-05T09:00:00.000Z",
  );
  await expect(dates.locator("time").nth(1)).toHaveAttribute(
    "datetime",
    "2026-10-04T05:40:00.000Z",
  );
  await expect(dates.locator("time").nth(1)).toContainText("오후 2:40");
  await expect(dates).toContainText("1일 3시간 20분 전");
  await page.reload();
  await expect(page.getByLabel("여유시간 (일)", { exact: true })).toHaveValue(
    "1",
  );
  await page.goto("/deadlines");
  const row = page.getByRole("link").filter({ hasText: deadline.title });
  await expect(row).toContainText("공식 마감");
  await expect(row).toContainText("안전 마감");
  await expect(row).toContainText("오후 2:40");
  await page.screenshot({
    path: test.info().outputPath("safe-deadline-list.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("editing preserves buffer, official precision, source and evidence; updates recalculate and disabling sends null", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("link").filter({ hasText: deadline.title }).click();
  await expect(page.getByLabel("여유시간 (일)", { exact: true })).toHaveValue(
    "1",
  );
  await expect(page.getByLabel("여유시간 (시간)", { exact: true })).toHaveValue(
    "3",
  );
  await expect(page.getByLabel("여유시간 (분)", { exact: true })).toHaveValue(
    "20",
  );
  await page.getByLabel("마감 제목").fill("[테스트] 제목만 수정");
  const sent = page.waitForRequest((r) => r.method() === "PATCH");
  await page.getByRole("button", { name: "변경 사항 저장" }).click();
  expect((await sent).postDataJSON()).toMatchObject({
    due_at: deadline.due_at,
    safety_buffer_minutes: 1640,
    source_id: deadline.source_id,
  });
  await expect(
    page.getByText(deadline.evidence_text!, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("변경 사항을 저장했습니다.")).toBeVisible();
  await page.getByLabel("여유시간 (일)", { exact: true }).fill("0");
  await page.getByLabel("여유시간 (시간)", { exact: true }).fill("3");
  await page.getByLabel("여유시간 (분)", { exact: true }).fill("0");
  const changed = page.waitForRequest((r) => r.method() === "PATCH");
  await page.getByRole("button", { name: "변경 사항 저장" }).click();
  expect((await changed).postDataJSON().safety_buffer_minutes).toBe(180);
  await expect(
    page.getByLabel("저장된 마감일").locator("time").nth(1),
  ).toHaveAttribute("datetime", "2026-10-05T06:00:45.123Z");
  await page.getByLabel("마감 일시 (한국 시간)").fill("2026-10-06T18:00");
  await page.getByRole("button", { name: "변경 사항 저장" }).click();
  await expect(
    page.getByLabel("저장된 마감일").locator("time").nth(1),
  ).toHaveAttribute("datetime", "2026-10-06T06:00:00.000Z");
  await page.screenshot({
    path: test.info().outputPath("safe-deadline-detail.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.getByLabel("안전 마감일 사용", { exact: true }).uncheck();
  const disabled = page.waitForRequest((r) => r.method() === "PATCH");
  await page.getByRole("button", { name: "변경 사항 저장" }).click();
  expect((await disabled).postDataJSON().safety_buffer_minutes).toBeNull();
  await expect(page.getByLabel("저장된 마감일")).toContainText("미설정");
  await page.reload();
  await expect(
    page.getByLabel("안전 마감일 사용", { exact: true }),
  ).not.toBeChecked();
  await page.goto("/deadlines");
  await expect(page.getByText("미설정", { exact: true })).toBeVisible();
});

test("blank, zero, negative, fractional and excessive buffers are blocked without losing input; API maximum is accepted", async ({
  page,
}) => {
  await open(page, []);
  await page.getByRole("button", { name: "＋ 마감일 등록" }).click();
  await page.getByLabel("마감 제목").fill("[테스트] 여유시간 검증");
  await page.getByLabel("마감 일시 (한국 시간)").fill("2026-10-05T18:00");
  await page.getByLabel("안전 마감일 사용", { exact: true }).check();
  let posts = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/deadlines")) posts++;
  });
  const minutes = page.getByLabel("여유시간 (분)", { exact: true });
  for (const value of [
    "",
    "0",
    "-1",
    "1.5",
    "1e3",
    "2147483648",
    "99999999999999999999",
  ]) {
    await minutes.fill(value);
    await page
      .getByRole("button", { name: "마감일 등록", exact: true })
      .click();
    await expect(
      page.getByRole("alert").filter({ hasText: "여유시간" }),
    ).toBeVisible();
    await expect(minutes).toHaveValue(value);
    await expect(page.getByLabel("마감 제목")).toHaveValue(
      "[테스트] 여유시간 검증",
    );
    expect(posts).toBe(0);
  }
  await page.getByLabel("여유시간 (일)", { exact: true }).fill("1491309");
  await minutes.fill("0");
  await page.getByRole("button", { name: "마감일 등록", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "합계" }),
  ).toBeVisible();
  expect(posts).toBe(0);
  await page.getByLabel("여유시간 (일)", { exact: true }).fill("");
  await minutes.fill("2147483647");
  // The maximum buffer needs a late enough official date to remain in the API's date range.
  await page.getByLabel("마감 일시 (한국 시간)").fill("9000-10-05T18:00");
  const sent = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/api/deadlines"),
  );
  await page.getByRole("button", { name: "마감일 등록", exact: true }).click();
  expect((await sent).postDataJSON().safety_buffer_minutes).toBe(2147483647);
  await expect(page).toHaveURL(/\/deadlines\/deadline-1$/);
});

test("422 preserves draft and saved dates, retry locks all fields and prevents duplicate requests", async ({
  page,
}) => {
  await open(page);
  await page.goto("/deadlines/deadline-1");
  await page.getByLabel("마감 제목").fill("[테스트] 오류 뒤 유지");
  await page.getByLabel("여유시간 (분)", { exact: true }).fill("21");
  await page.route("**/test-api/api/deadlines/deadline-1", (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({
          status: 422,
          json: {
            detail: [
              {
                msg: "Value error, safety buffer places safe_due_at outside the supported date range",
              },
            ],
          },
        })
      : route.fallback(),
  );
  await page.getByRole("button", { name: "변경 사항 저장" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "지원되는 날짜 범위" }),
  ).toBeVisible();
  await expect(page.getByLabel("마감 제목")).toHaveValue(
    "[테스트] 오류 뒤 유지",
  );
  await expect(page.getByLabel("여유시간 (분)", { exact: true })).toHaveValue(
    "21",
  );
  await expect(
    page.getByLabel("저장된 마감일").locator("time").nth(1),
  ).toHaveAttribute("datetime", deadline.safe_due_at!);
  await page.unroute("**/test-api/api/deadlines/deadline-1");
  let requests = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/test-api/api/deadlines/deadline-1", async (route) => {
    if (route.request().method() === "PATCH") {
      requests++;
      await pending;
    }
    await route.fallback();
  });
  try {
    await page
      .getByRole("button", { name: "변경 사항 저장" })
      .evaluate((button) => {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    await expect.poll(() => requests).toBe(1);
    await expect(page.getByRole("button", { name: "저장 중…" })).toBeDisabled();
    await expect(
      page.getByLabel("안전 마감일 사용", { exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByLabel("여유시간 (분)", { exact: true }),
    ).toBeDisabled();
  } finally {
    release();
  }
  await expect(page.getByLabel("저장된 마감일")).toContainText(
    "1일 3시간 21분 전",
  );
});

test("missing or inaccessible deadline is explained and expired save removes the local session", async ({
  page,
}) => {
  await open(page);
  await page.goto("/deadlines/not-owned");
  await expect(
    page.getByRole("alert").filter({ hasText: "접근할 수 없는 마감일" }),
  ).toBeVisible();
  await page.goto("/deadlines/deadline-1");
  await page.getByLabel("여유시간 (분)", { exact: true }).fill("21");
  await page.route("**/test-api/api/deadlines/deadline-1", (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({ status: 401, json: { detail: "Unauthorized" } })
      : route.fallback(),
  );
  await page.getByRole("button", { name: "변경 사항 저장" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(
    await page.evaluate(() => sessionStorage.getItem("plancatch.access_token")),
  ).toBeNull();
});
