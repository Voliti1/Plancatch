import { test, expect, type Page } from "@playwright/test";
import { login, mockApi } from "./fixtures";
import { aiSource, mockAnalyses, readyAnalysis } from "./analysis-fixtures";
import { calendarTask } from "./calendar-fixtures";

async function confirmMove(
  page: Page,
  accept: boolean,
  action: () => Promise<unknown>,
) {
  const dialog = page.waitForEvent("dialog");
  const actionDone = action();
  const prompt = await dialog;
  expect(prompt.type()).toBe("confirm");
  expect(prompt.message()).toContain("저장하지 않은 내용");
  if (accept) await prompt.accept();
  else await prompt.dismiss();
  await actionDone;
}
const sources = (page: Page) =>
  page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("link", { name: "원본 자료", exact: true });
const fresh = (page: Page) =>
  page.getByRole("link", { name: "새 일정 등록하기", exact: true });

test("source text survives cancelled navigation; fresh registration resets only after approval", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  await fresh(page).click();
  await expect(page).toHaveURL(/\/sources\/new\?new=/);
  const originalUrl = page.url();
  await page
    .getByLabel("원본 텍스트", { exact: true })
    .fill("[테스트] 아직 저장하지 않은 공지");
  await confirmMove(page, false, () => sources(page).click());
  await expect(page).toHaveURL(originalUrl);
  await expect(page.getByLabel("원본 텍스트", { exact: true })).toHaveValue(
    "[테스트] 아직 저장하지 않은 공지",
  );
  await confirmMove(page, false, () => fresh(page).click());
  await expect(page).toHaveURL(originalUrl);
  await confirmMove(page, true, () => fresh(page).click());
  await expect(page).not.toHaveURL(originalUrl);
  await expect(page.getByLabel("원본 텍스트", { exact: true })).toHaveValue("");
  await sources(page).click();
  await expect(page).toHaveURL(/\/sources$/);
});

test("empty and reverted forms do not prompt; switching tabs keeps hidden input protected", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  let unexpected = 0;
  const dismiss = async (dialog: import("@playwright/test").Dialog) => {
    unexpected++;
    await dialog.dismiss();
  };
  page.on("dialog", dismiss);
  await fresh(page).click();
  const text = page.getByLabel("원본 텍스트", { exact: true });
  await text.fill("잠깐 입력");
  await text.fill("");
  await sources(page).click();
  await expect(page).toHaveURL(/\/sources$/);
  await fresh(page).click();
  await text.fill("[테스트] 탭 전환으로 지우지 않는 입력");
  await page.getByRole("tab", { name: "수동 일정 등록", exact: true }).click();
  expect(unexpected).toBe(0);
  page.off("dialog", dismiss);
  await confirmMove(page, false, () => sources(page).click());
  await page.getByRole("tab", { name: "자료로 등록", exact: true }).click();
  await expect(text).toHaveValue("[테스트] 탭 전환으로 지우지 않는 입력");
});

test("selected PDF is protected; removing it restores a clean form", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  await fresh(page).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "[테스트] 공지.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\npreview-only\n%%EOF"),
  });
  await confirmMove(page, false, () => sources(page).click());
  await page.getByRole("button", { name: /제거/ }).click();
  await sources(page).click();
  await expect(page).toHaveURL(/\/sources$/);
});

test("save failure retains protection and successful manual save clears it", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  await page.goto("/sources/new?mode=manual");
  await page
    .getByLabel("일정명", { exact: true })
    .fill("[테스트] 보호되는 회의");
  await page.getByLabel("시작 일시", { exact: true }).fill("2026-11-06T14:00");
  await page.getByLabel("종료 일시", { exact: true }).fill("2026-11-06T15:00");
  await page.route("**/test-api/api/tasks", (route) =>
    route.fulfill({ status: 422, json: { detail: "[테스트] 저장 실패" } }),
  );
  await page.getByRole("button", { name: "일정 등록", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "저장 실패",
  );
  await confirmMove(page, false, () => sources(page).click());
  await expect(page.getByLabel("일정명", { exact: true })).toHaveValue(
    "[테스트] 보호되는 회의",
  );
  await page.unroute("**/test-api/api/tasks");
  await page.getByRole("button", { name: "일정 등록", exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\/task-/);
  await sources(page).click();
  await expect(page).toHaveURL(/\/sources$/);
});

test("editing a source can be kept or explicitly discarded without leaving a stale guard", async ({
  page,
}) => {
  await mockApi(page, [aiSource]);
  await login(page);
  await page.goto("/sources/" + aiSource.id);
  await page.getByRole("button", { name: "자료 수정", exact: true }).click();
  await page.getByLabel("일정 제목 (선택)").fill("[테스트] 저장하지 않은 제목");
  await confirmMove(page, false, () =>
    page.getByRole("button", { name: "취소", exact: true }).click(),
  );
  await expect(page.getByLabel("일정 제목 (선택)")).toHaveValue(
    "[테스트] 저장하지 않은 제목",
  );
  await confirmMove(page, true, () =>
    page.getByRole("button", { name: "취소", exact: true }).click(),
  );
  await expect(
    page.getByRole("heading", { name: aiSource.title!, exact: true }),
  ).toBeVisible();
  await sources(page).click();
  await expect(page).toHaveURL(/\/sources$/);
});

test("task edit reversion and confirmed cancel restore the saved values", async ({
  page,
}) => {
  await mockApi(page, [], { tasks: [calendarTask] });
  await login(page);
  await page.goto("/tasks/" + calendarTask.id);
  await page.getByRole("button", { name: "일정 수정", exact: true }).click();
  await page.getByLabel("일정명", { exact: true }).fill("[테스트] 바꾼 일정");
  await confirmMove(page, false, () => sources(page).click());
  await page.getByLabel("일정명", { exact: true }).fill(calendarTask.title);
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await sources(page).click();
  await expect(page).toHaveURL(/\/sources$/);
});

test("AI review warns on edits, preserves them on error and clears after saving", async ({
  page,
}) => {
  await mockAnalyses(page);
  await login(page);
  await page.goto("/analyses/" + readyAnalysis.id);
  const title = page.getByLabel("후보 1 제목", { exact: true });
  await title.fill("[테스트] 수정한 후보");
  await page.route("**/test-api/api/ai-analyses/analysis-1", (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({
          status: 503,
          json: { detail: "[테스트] 검토 저장 실패" },
        })
      : route.fallback(),
  );
  await page
    .getByRole("button", { name: "검토 내용 저장", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await confirmMove(page, false, () => sources(page).click());
  await expect(title).toHaveValue("[테스트] 수정한 후보");
  await page.unroute("**/test-api/api/ai-analyses/analysis-1");
  await page
    .getByRole("button", { name: "검토 내용 저장", exact: true })
    .click();
  await expect(
    page.getByText("검토 내용을 저장했습니다.", { exact: true }),
  ).toBeVisible();
  await sources(page).click();
  await expect(page).toHaveURL(/\/sources$/);
});

test("reload uses the browser warning and cancelling keeps the draft", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  await fresh(page).click();
  await page
    .getByLabel("원본 텍스트", { exact: true })
    .fill("[테스트] 새로고침 보호");
  await page
    .getByRole("heading", { name: "새 일정 등록", exact: true })
    .click();
  const dialog = page.waitForEvent("dialog");
  const reload = page.reload({ timeout: 3000 }).catch(() => null);
  const prompt = await dialog;
  expect(prompt.type()).toBe("beforeunload");
  await prompt.dismiss();
  await reload;
  await expect(page.getByLabel("원본 텍스트", { exact: true })).toHaveValue(
    "[테스트] 새로고침 보호",
  );
});

test("Back cancellation restores history without duplicate entries; accepted Back and Forward work", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  await sources(page).click();
  await fresh(page).click();
  await expect(page).toHaveURL(/\/sources\/new\?new=/);
  const url = page.url();
  await page
    .getByLabel("원본 텍스트", { exact: true })
    .fill("[테스트] 뒤로 가기 보호");
  const length = await page.evaluate(() => history.length);
  await confirmMove(page, false, () => page.evaluate(() => history.back()));
  await expect(page).toHaveURL(url);
  await expect(page.getByLabel("원본 텍스트", { exact: true })).toHaveValue(
    "[테스트] 뒤로 가기 보호",
  );
  expect(await page.evaluate(() => history.length)).toBe(length);
  await confirmMove(page, true, () => page.evaluate(() => history.back()));
  await expect(page).toHaveURL(/\/sources$/);
  await page.goForward();
  await expect(page).toHaveURL(url);
  expect(await page.evaluate(() => history.length)).toBe(length);
});

test("deadline edits are protected, saving clears the warning, and logout asks before discarding", async ({
  page,
}) => {
  const deadline = {
    id: "protected-deadline",
    title: "[테스트] 마감일",
    due_at: "2026-11-10T09:00:00Z",
    source_id: null,
    description: null,
    deadline_type: null,
    is_confirmed: true,
    safety_buffer_minutes: null,
    safe_due_at: null,
    confidence: null,
    evidence_text: null,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
  };
  await mockApi(page, [], { deadlines: [deadline] });
  await login(page);
  await page.goto("/deadlines/" + deadline.id);
  await page
    .getByLabel("마감 제목", { exact: true })
    .fill("[테스트] 수정한 마감");
  await confirmMove(page, false, () => sources(page).click());
  await page
    .getByRole("button", { name: "변경 사항 저장", exact: true })
    .click();
  await expect(
    page.getByText("변경 사항을 저장했습니다.", { exact: true }),
  ).toBeVisible();
  await sources(page).click();
  await expect(page).toHaveURL(/\/sources$/);
  await fresh(page).click();
  await page
    .getByLabel("원본 텍스트", { exact: true })
    .fill("[테스트] 로그아웃 전 입력");
  const logout = page.getByRole("button", { name: "로그아웃 ↗", exact: true });
  await confirmMove(page, false, () => logout.click());
  await expect(page.getByLabel("원본 텍스트", { exact: true })).toHaveValue(
    "[테스트] 로그아웃 전 입력",
  );
  await confirmMove(page, true, () => logout.click());
  await expect(page).toHaveURL(/\/login$/);
});

test("browsers without Navigation API still protect menu changes", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "navigation", {
      value: undefined,
      configurable: true,
    }),
  );
  await mockApi(page);
  await login(page);
  await fresh(page).click();
  await page
    .getByLabel("원본 텍스트", { exact: true })
    .fill("[테스트] 기본 이동 보호");
  await confirmMove(page, false, () => sources(page).click());
  await expect(page.getByLabel("원본 텍스트", { exact: true })).toHaveValue(
    "[테스트] 기본 이동 보호",
  );
  await confirmMove(page, true, () => sources(page).click());
  await expect(page).toHaveURL(/\/sources$/);
});
