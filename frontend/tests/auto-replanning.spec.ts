import { expect, test, type Page } from "@playwright/test";
import { login, mockApi } from "./fixtures";

const task = {
  id: "replace-task",
  title: "다시 배치할 보고서",
  sort_at: "2026-11-18T09:00:00Z",
  deadline_id: null,
  estimated_minutes: 60,
  priority: 3,
  schedule_type: "flexible",
  earliest_start: null,
  latest_end: null,
  is_completed: false,
};
function plan() {
  return {
    id: "replace-plan",
    request: {
      start_at: "2026-11-15T15:00:00Z",
      end_at: "2026-11-16T15:00:00Z",
      include_google: true,
    },
    blocks: [
      {
        id: "new-block",
        task_id: task.id,
        title: task.title,
        start_at: "2026-11-16T00:00:00Z",
        end_at: "2026-11-16T01:00:00Z",
      },
    ],
    details: {
      replace_existing: true,
      replaced_blocks: [
        {
          id: "old-block",
          task_id: task.id,
          title: task.title,
          start_at: "2026-11-17T03:00:00Z",
          end_at: "2026-11-17T04:00:00Z",
        },
      ],
      blocked: false,
      warnings: [],
      google_state: "not_connected",
      unplaced: [],
      tasks: [
        {
          id: task.id,
          title: task.title,
          minutes: 60,
          limit: "2026-11-18T09:00:00Z",
          priority: 3,
          uses_safety_deadline: false,
        },
      ],
    },
    expires_at: "2099-11-10T00:00:00Z",
    approved_at: null as string | null,
    approved_event_ids: [] as string[],
  };
}
async function open(page: Page, deepLink = false) {
  await mockApi(page);
  await login(page);
  await page.route("**/test-api/api/scheduling/tasks?*", (r) =>
    r.fulfill({
      json: {
        entries:
          new URL(r.request().url()).searchParams.get("replace_existing") ===
          "true"
            ? [task]
            : [],
        has_more: false,
      },
    }),
  );
  await page.goto(deepLink ? "/planning?mode=replan" : "/planning");
  if (!deepLink)
    await page
      .getByRole("button", { name: "기존 배치 다시 짜기", exact: true })
      .click();
  await expect(
    page.getByRole("button", { name: "기존 배치 다시 짜기", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("combobox", { name: "할 일 제목 검색" }).click();
  await page.getByRole("checkbox", { name: /다시 배치할 보고서/ }).check();
  await page.getByLabel("배치 시작일", { exact: true }).fill("2026-11-16");
  await page.getByLabel("배치 종료일", { exact: true }).fill("2026-11-16");
}

test("replacement compares old and new times and only explicit approval sends a replacement", async ({
  page,
}) => {
  await open(page);
  let previews = 0,
    approvals = 0,
    legacyWrites = 0;
  const current = plan();
  page.on("request", (r) => {
    if (r.method() !== "GET" && r.url().includes("/api/scheduled-events"))
      legacyWrites++;
  });
  await page.route("**/test-api/api/scheduling/preview", (r) => {
    previews++;
    expect(r.request().postDataJSON()).toMatchObject({
      task_ids: [task.id],
      replace_existing: true,
    });
    return r.fulfill({ status: 201, json: current });
  });
  await page.route(
    "**/test-api/api/scheduling/plans/replace-plan/approve",
    (r) => {
      approvals++;
      expect(r.request().postDataJSON().blocks).toHaveLength(1);
      current.approved_at = "2026-11-10T03:00:00Z";
      current.approved_event_ids = ["new-block"];
      return r.fulfill({ json: current });
    },
  );
  await page
    .getByRole("button", { name: "재배치 미리보기 만들기", exact: true })
    .click();
  const result = page.getByRole("region", {
    name: "자동 배치 미리보기",
    exact: true,
  });
  await expect(
    result.getByRole("region", { name: "재배치 변경 비교" }),
  ).toContainText("기존 시간은 아직 유지");
  await expect(
    result.getByRole("region", { name: "재배치 변경 비교" }),
  ).toContainText("2026. 11. 17.");
  expect(approvals).toBe(0);
  expect(legacyWrites).toBe(0);
  await result.screenshot({
    path: test.info().outputPath("replacement-comparison.png"),
  });
  await result
    .getByRole("button", { name: "선택한 기존 배치 교체", exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(result).toContainText("배치 저장 완료");
  await expect(result).toContainText("교체 전 배치 기록");
  expect(previews).toBe(1);
  expect(approvals).toBe(1);
  expect(legacyWrites).toBe(0);
  await result
    .getByRole("button", { name: "다시 배치하기", exact: true })
    .click();
  await expect(result).toHaveCount(0);
  await expect(page.locator(".planning-picker > p")).toContainText("0개 선택");
  await expect(
    page.getByRole("button", { name: "기존 배치 다시 짜기", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("stale replacement never deletes directly and changing mode drops old preview and selection", async ({
  page,
}) => {
  await open(page, true);
  let approvals = 0;
  await page.route("**/test-api/api/scheduling/preview", (r) =>
    r.fulfill({ status: 201, json: plan() }),
  );
  await page.route(
    "**/test-api/api/scheduling/plans/replace-plan/approve",
    (r) => {
      approvals++;
      return r.fulfill({
        status: 409,
        json: { detail: "기존 배치가 변경됐습니다. 다시 확인해 주세요." },
      });
    },
  );
  await page
    .getByRole("button", { name: "재배치 미리보기 만들기", exact: true })
    .click();
  const result = page.getByRole("region", {
    name: "자동 배치 미리보기",
    exact: true,
  });
  await result
    .getByRole("checkbox", {
      name: "다시 배치할 보고서 배치 포함",
      exact: true,
    })
    .uncheck();
  await expect(
    result.getByRole("region", { name: "재배치 변경 비교" }),
  ).toContainText("기존 시간 유지");
  await expect(
    result.getByRole("button", { name: "선택한 기존 배치 교체", exact: true }),
  ).toBeDisabled();
  await result
    .getByRole("checkbox", {
      name: "다시 배치할 보고서 배치 포함",
      exact: true,
    })
    .check();
  await result
    .getByRole("button", { name: "선택한 기존 배치 교체", exact: true })
    .click();
  await expect(result.getByRole("alert")).toContainText(
    "기존 배치가 변경됐습니다",
  );
  expect(approvals).toBe(1);
  await page
    .getByRole("button", { name: "새 배치 만들기", exact: true })
    .click();
  await expect(result).toHaveCount(0);
  await expect(page.locator(".planning-picker > p")).toContainText("0개 선택");
  await expect(
    page.getByRole("button", { name: "배치 미리보기 만들기", exact: true }),
  ).toBeDisabled();
});
