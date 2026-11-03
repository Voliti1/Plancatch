import { test, expect } from "@playwright/test";
import { mockApi, login } from "./fixtures";

const draft = {
  kind: "task",
  title: "회의",
  start_at: "2026-11-03T15:00:00+09:00",
  end_at: "2026-11-03T16:00:00+09:00",
  reference_at: "2026-11-02T12:00:00+09:00",
  timezone: "Asia/Seoul",
  notices: [],
};

test("today is the default and uses the same short date header as week", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-11-02T03:00:00Z") });
  await mockApi(page);
  await login(page);
  await page.goto("/calendar");
  const day = page.getByRole("region", { name: "하루 시간표" });
  await expect(day).toBeVisible();
  await expect(
    day.getByRole("button", { name: "2026년 11월 2일 월요일", exact: true }),
  ).toHaveText("11/2 (월)");
  await expect(page.getByRole("group", { name: "월간 날짜" })).toHaveCount(0);
  await page.getByRole("button", { name: "주간", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "주간 시간표" })
      .getByRole("button", { name: "2026년 11월 2일 월요일", exact: true }),
  ).toHaveText("11/2 (월)");
});

test("manual fields are always available and switching tabs keeps them without interpreting or writing", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  const calls: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST") calls.push(r.url());
  });
  await page.goto("/sources/new?mode=manual");
  await expect(page.getByRole("tab")).toHaveCount(2);
  const widths = await page
    .getByRole("tab")
    .evaluateAll((items) =>
      items.map((item) => item.getBoundingClientRect().width),
    );
  expect(Math.abs(widths[0] - widths[1])).toBeLessThanOrEqual(1);
  const tabs = page.getByRole("tablist", { name: "일정 등록 방식" });
  expect(widths.reduce((sum, width) => sum + width, 0)).toBeGreaterThan(
    (await tabs.boundingBox())!.width * 0.9,
  );
  await expect(
    page.getByRole("heading", { name: "수동 일정 등록", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "일정 미리보기", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("일정명", { exact: true }).fill("직접 쓴 일정");
  await page.getByRole("tab", { name: "자료로 등록", exact: true }).click();
  await page.getByRole("tab", { name: "수동 일정 등록", exact: true }).click();
  await expect(page.getByLabel("일정명", { exact: true })).toHaveValue(
    "직접 쓴 일정",
  );
  expect(calls).toEqual([]);
});

test("rapid sentence edits debounce to one interpretation and never save automatically", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  await page.goto("/sources/new?mode=manual");
  let interpretations = 0,
    writes = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && /\/api\/(tasks|deadlines)$/.test(r.url()))
      writes++;
  });
  await page.route("**/api/schedules/interpret", (route) => {
    interpretations++;
    return route.fulfill({ json: draft });
  });
  const input = page.getByLabel("일정 설명 (선택)", { exact: true });
  await input.fill("내일");
  await input.fill("내일 오후 3시 회의");
  await expect(page.getByLabel("일정명", { exact: true })).toHaveValue("회의");
  expect(interpretations).toBe(1);
  expect(writes).toBe(0);
  await page.screenshot({
    path: test.info().outputPath("combined-manual.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("manual edits cancel a pending interpretation and cannot be overwritten by its late result", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  await page.goto("/sources/new?mode=manual");
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route("**/api/schedules/interpret", async (route) => {
    await gate;
    await route.fulfill({ json: draft }).catch(() => {});
  });
  const sent = page.waitForRequest((r) =>
    r.url().endsWith("/api/schedules/interpret"),
  );
  await page.getByLabel("일정 설명 (선택)", { exact: true }).fill("내일 회의");
  await sent;
  const title = page.getByLabel("일정명", { exact: true });
  await title.fill("직접 수정한 제목");
  release();
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(title).toHaveValue("직접 수정한 제목");
  await page.getByRole("tab", { name: "자료로 등록", exact: true }).click();
  await page.getByRole("tab", { name: "수동 일정 등록", exact: true }).click();
  await expect(title).toHaveValue("직접 수정한 제목");
});

test("Korean composition does not interpret unfinished text", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  await page.goto("/sources/new?mode=manual");
  let calls = 0;
  await page.route("**/api/schedules/interpret", (route) => {
    calls++;
    return route.fulfill({ json: draft });
  });
  const input = page.getByLabel("일정 설명 (선택)", { exact: true });
  await input.dispatchEvent("compositionstart");
  await input.fill("내일 회");
  await page.waitForTimeout(750);
  expect(calls).toBe(0);
  await input.fill("내일 회의");
  await input.dispatchEvent("compositionend");
  await expect(page.getByLabel("일정명", { exact: true })).toHaveValue("회의");
  expect(calls).toBe(1);
});
