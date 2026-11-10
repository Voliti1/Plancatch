import { test, expect, type Page } from "@playwright/test";
import { login, mockApi } from "./fixtures";
import type { NaturalScheduleDraft } from "../types/natural-schedule";

const draft: NaturalScheduleDraft = {
  kind: "task",
  title: "회의",
  start_at: "2026-11-03T15:00:00+09:00",
  end_at: "2026-11-03T16:00:00+09:00",
  reference_at: "2026-11-02T12:00:00+09:00",
  timezone: "Asia/Seoul",
  notices: [],
};

async function setup(page: Page, result = draft) {
  await mockApi(page);
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && /\/api\/(?:tasks|deadlines)$/.test(path))
      writes.push({ path, body: request.postDataJSON() });
  });
  await page.route("**/api/schedules/interpret", (route) =>
    route.fulfill({ json: result }),
  );
  await login(page);
  await page.goto("/sources/new?mode=natural");
  return writes;
}

test("sentence preview is not a write, starts in Seoul time, stays editable and creates one fixed task", async ({
  page,
}) => {
  const writes = await setup(page);
  await page
    .getByRole("button", {
      name: "내일 오후 3시부터 4시까지 회의",
      exact: true,
    })
    .click();

  const preview = page.getByRole("region", { name: "일정 입력", exact: true });
  await expect(
    preview.getByRole("button", { name: "할 일", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(preview.getByLabel("시작 일시", { exact: true })).toHaveValue(
    "2026-11-03T15:00",
  );
  await expect(preview.getByLabel("종료 일시", { exact: true })).toHaveValue(
    "2026-11-03T16:00",
  );
  expect(writes).toHaveLength(0);
  await preview.getByLabel("일정명", { exact: true }).fill("검토한 회의");
  await preview
    .getByLabel("종료 일시", { exact: true })
    .fill("2026-11-03T16:30");
  await preview.getByRole("button", { name: "일정 등록", exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\/task-1$/);
  expect(writes).toHaveLength(1);
  expect(writes[0].body).toMatchObject({
    title: "검토한 회의",
    schedule_type: "fixed",
    earliest_start: "2026-11-03T15:00:00+09:00",
    latest_end: "2026-11-03T07:30:00.000Z",
  });
});

test("a deadline only asks for its end, can change kind, and saves the confirmed date", async ({
  page,
}) => {
  const writes = await setup(page, {
    ...draft,
    kind: "deadline",
    title: "보고서 제출",
    start_at: null,
    end_at: "2026-11-06T15:00:00+09:00",
  });
  await page
    .getByLabel("일정 설명", { exact: true })
    .fill("금요일 오후 3시 보고서 제출");

  const preview = page.getByRole("region", { name: "일정 입력", exact: true });
  await expect(preview.getByLabel("시작 일시", { exact: true })).toHaveCount(0);
  await expect(preview.getByLabel("마감 일시", { exact: true })).toHaveValue(
    "2026-11-06T15:00",
  );
  await preview.getByRole("button", { name: "할 일", exact: true }).click();
  await expect(preview.getByLabel("시작 일시", { exact: true })).toBeVisible();
  await preview.getByRole("button", { name: "마감일", exact: true }).click();
  expect(writes).toHaveLength(0);
  await preview
    .getByRole("button", { name: "마감일 등록", exact: true })
    .click();
  await expect(page).toHaveURL(/\/deadlines\//);
  expect(writes).toHaveLength(1);
  expect(writes[0].body).toMatchObject({
    title: "보고서 제출",
    due_at: "2026-11-06T06:00:00.000Z",
    is_confirmed: true,
    source_id: null,
  });
});

test("unresolved dates can be completed manually; editing the sentence removes its old draft", async ({
  page,
}) => {
  const writes = await setup(page, {
    ...draft,
    start_at: null,
    end_at: null,
    notices: ["날짜를 직접 선택해 주세요."],
  });
  await page.getByLabel("일정 설명", { exact: true }).fill("나중에 회의");

  const preview = page.getByRole("region", { name: "일정 입력", exact: true });
  await expect(preview).toContainText("날짜를 직접 선택해 주세요.");
  await preview.getByRole("button", { name: "일정 등록", exact: true }).click();
  await expect(preview).toContainText("시작 일시와 종료 일시를 입력해 주세요.");
  expect(writes).toHaveLength(0);
  await page
    .getByLabel("일정 설명", { exact: true })
    .fill("모레 오후 5시 면접");
  await expect(preview).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("읽는 중");
  await expect(page.getByRole("status")).toHaveCount(0);

  await preview
    .getByLabel("시작 일시", { exact: true })
    .fill("2026-11-04T17:00");
  await preview
    .getByLabel("종료 일시", { exact: true })
    .fill("2026-11-04T18:00");
  await preview.getByRole("button", { name: "일정 등록", exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\/task-1$/);
});

test("preview errors keep the sentence, retry safely, and tabs support keyboard cycling", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/schedules/interpret", (route) =>
    route.fulfill({
      status: 503,
      json: { detail: "잠시 후 다시 시도해 주세요." },
    }),
  );
  await page.getByLabel("일정 설명", { exact: true }).fill("내일 회의");

  await expect(
    page.locator(".natural-registration").getByRole("alert"),
  ).toContainText("다시 시도");
  await expect(page.getByLabel("일정 설명", { exact: true })).toHaveValue(
    "내일 회의",
  );
  const natural = page.getByRole("tab", {
    name: "수동 일정 등록",
    exact: true,
  });
  await natural.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "자료로 등록", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("tab", { name: "수동 일정 등록", exact: true })
    .press("Home");
  await expect(
    page.getByRole("tab", { name: "자료로 등록", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("tab", { name: "자료로 등록", exact: true })
    .press("ArrowRight");
  await expect(natural).toBeFocused();
  await expect(page.getByLabel("일정 설명", { exact: true })).toHaveValue(
    "내일 회의",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("a late preview cannot restore an old registration after the sidebar opens a new one", async ({
  page,
}) => {
  await setup(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/schedules/interpret", async (route) => {
    await pending;
    await route.fulfill({ json: draft }).catch(() => {});
  });
  const sent = page.waitForRequest((request) =>
    request.url().endsWith("/api/schedules/interpret"),
  );
  await page
    .getByLabel("일정 설명", { exact: true })
    .fill("내일 오후 3시 회의");

  await sent;
  await expect(
    page.getByRole("tab", { name: "수동 일정 등록", exact: true }),
  ).toBeEnabled();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("link", { name: "새 일정 등록하기", exact: true })
    .click();
  release();
  await expect(
    page.getByRole("tab", { name: "자료로 등록", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "수동 일정 등록", exact: true }).click();
  await expect(page.getByLabel("일정명", { exact: true })).toHaveValue("");
  await page.getByRole("tab", { name: "문장으로 등록", exact: true }).click();
  await expect(page.getByLabel("일정 설명", { exact: true })).toHaveValue("");
  await expect(
    page.getByRole("region", { name: "일정 입력", exact: true }),
  ).toHaveCount(0);
});
