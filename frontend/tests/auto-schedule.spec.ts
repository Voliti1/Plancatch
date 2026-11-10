import { expect, test } from "@playwright/test";
import { login, mockApi } from "./fixtures";
import type { Task } from "../types/task";

const task: Task = {
  id: "auto-task",
  deadline_id: null,
  title: "보고서 준비",
  description: null,
  estimated_minutes: 120,
  priority: 4,
  schedule_type: "flexible",
  earliest_start: null,
  latest_end: null,
  is_completed: false,
  completed_at: null,
  created_at: "2026-11-10T00:00:00Z",
  updated_at: "2026-11-10T00:00:00Z",
};
function plan() {
  return {
    id: "preview-1",
    request: {
      start_at: "2026-11-15T15:00:00Z",
      end_at: "2026-11-16T15:00:00Z",
      include_google: true,
    },
    blocks: [
      {
        id: "block-1",
        task_id: task.id,
        title: task.title,
        start_at: "2026-11-16T01:00:00Z",
        end_at: "2026-11-16T02:00:00Z",
      },
      {
        id: "block-2",
        task_id: task.id,
        title: task.title,
        start_at: "2026-11-16T02:00:00Z",
        end_at: "2026-11-16T03:00:00Z",
      },
    ],
    details: {
      blocked: false,
      warnings: [],
      google_state: "checked",
      unplaced: [],
      tasks: [
        {
          id: task.id,
          title: task.title,
          minutes: 120,
          priority: 4,
          limit: "2026-11-16T04:00:00Z",
          uses_safety_deadline: true,
        },
      ],
    },
    expires_at: "2026-11-10T03:15:00Z",
    approved_at: null as string | null,
    approved_event_ids: [] as string[],
  };
}
async function open(page: import("@playwright/test").Page) {
  await mockApi(page, [], { tasks: [task] });
  await login(page);
  await page.route("**/test-api/api/scheduling/tasks?*", (route) =>
    route.fulfill({ json: { entries: [task], has_more: false } }),
  );
  await page.goto("/planning");
  await page.getByRole("checkbox", { name: /보고서 준비/ }).check();
  await page.getByLabel("배치 시작일", { exact: true }).fill("2026-11-16");
  await page.getByLabel("배치 종료일", { exact: true }).fill("2026-11-16");
}

test("preview does not write calendar blocks and edited times are explicitly approved", async ({
  page,
}) => {
  await open(page);
  let current = plan(),
    previews = 0,
    approvals = 0,
    legacyWrites = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/scheduled-events"))
      legacyWrites++;
  });
  await page.route("**/test-api/api/scheduling/preview", (route) => {
    previews++;
    expect(route.request().postDataJSON()).toMatchObject({
      task_ids: [task.id],
      start_at: "2026-11-15T15:00:00.000Z",
      end_at: "2026-11-16T15:00:00.000Z",
      weekdays: [0, 1, 2, 3, 4],
      include_google: true,
    });
    return route.fulfill({ status: 201, json: current });
  });
  await page.route(
    "**/test-api/api/scheduling/plans/preview-1/approve",
    (route) => {
      approvals++;
      const sent = route.request().postDataJSON();
      expect(sent.blocks[0]).toEqual({
        id: "block-1",
        start_at: "2026-11-16T05:00:00.000Z",
        end_at: "2026-11-16T06:00:00.000Z",
      });
      current = {
        ...current,
        approved_at: "2026-11-10T03:01:00Z",
        approved_event_ids: ["block-1", "block-2"],
      };
      return route.fulfill({ json: current });
    },
  );
  await page
    .getByRole("button", { name: "배치 미리보기 만들기", exact: true })
    .click();
  const result = page.getByRole("region", {
    name: "자동 배치 미리보기",
    exact: true,
  });
  await expect(result).toContainText("아직 캘린더에는 저장되지 않았습니다.");
  expect(approvals).toBe(0);
  await result
    .getByLabel("보고서 준비 1 시작", { exact: true })
    .fill("2026-11-16T14:00");
  await result.screenshot({
    path: test.info().outputPath("automatic-preview.png"),
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await result
    .getByRole("button", { name: "선택한 배치 승인", exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(result).toContainText("승인한 시간 2개를 저장했습니다.");
  expect(previews).toBe(1);
  expect(approvals).toBe(1);
  expect(legacyWrites).toBe(0);
});

test("approval retry preserves edits and uses the same preview identity", async ({
  page,
}) => {
  await open(page);
  let approvals = 0;
  await page.route("**/test-api/api/scheduling/preview", (route) =>
    route.fulfill({ status: 201, json: plan() }),
  );
  await page.route(
    "**/test-api/api/scheduling/plans/preview-1/approve",
    (route) => {
      approvals++;
      return approvals === 1
        ? route.fulfill({
            status: 503,
            json: { detail: "저장 결과를 확인하지 못했습니다." },
          })
        : route.fulfill({
            json: {
              ...plan(),
              approved_at: "2026-11-10T03:01:00Z",
              approved_event_ids: ["block-1", "block-2"],
            },
          });
    },
  );
  await page
    .getByRole("button", { name: "배치 미리보기 만들기", exact: true })
    .click();
  await page
    .getByLabel("보고서 준비 1 시작", { exact: true })
    .fill("2026-11-16T14:00");
  await page
    .getByRole("button", { name: "선택한 배치 승인", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "중복 저장하지 않습니다",
  );
  await expect(
    page.getByLabel("보고서 준비 1 시작", { exact: true }),
  ).toHaveValue("2026-11-16T14:00");
  await page
    .getByRole("button", { name: "선택한 배치 승인", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "배치 저장 완료", exact: true }),
  ).toBeVisible();
  expect(approvals).toBe(2);
});

test("partial Google checks block approval and changed settings discard stale preview", async ({
  page,
}) => {
  await open(page);
  await page.route("**/test-api/api/scheduling/preview", (route) =>
    route.fulfill({
      status: 201,
      json: {
        ...plan(),
        details: {
          ...plan().details,
          blocked: true,
          warnings: [
            "구글 일정을 일부만 확인했습니다. 기간을 줄여 다시 만들어 주세요.",
          ],
        },
      },
    }),
  );
  await page
    .getByRole("button", { name: "배치 미리보기 만들기", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "선택한 배치 승인", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", {
      name: "연결된 구글 기본 캘린더의 바쁨 일정도 피하기",
      exact: true,
    })
    .uncheck();
  await expect(
    page.getByRole("region", { name: "자동 배치 미리보기", exact: true }),
  ).toHaveCount(0);
});

test("expired or changed data errors do not save any partial result and excluded tasks stay grouped", async ({
  page,
}) => {
  await open(page);
  await page.route("**/test-api/api/scheduling/preview", (route) =>
    route.fulfill({
      status: 201,
      json: {
        ...plan(),
        details: {
          ...plan().details,
          unplaced: [
            {
              task_id: "missing",
              title: "일정 준비",
              reason: "소요시간을 입력해 주세요.",
            },
          ],
        },
      },
    }),
  );
  await page.route(
    "**/test-api/api/scheduling/plans/preview-1/approve",
    (route) =>
      route.fulfill({
        status: 409,
        json: {
          detail: "기존 일정이 변경됐습니다. 새 미리보기를 만들어 주세요.",
        },
      }),
  );
  await page
    .getByRole("button", { name: "배치 미리보기 만들기", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "자동 배치 미리보기", exact: true }),
  ).toContainText("소요시간을 입력해 주세요.");
  await page
    .getByRole("checkbox", { name: "보고서 준비 배치 포함", exact: true })
    .uncheck();
  await expect(
    page.getByRole("button", { name: "선택한 배치 승인", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", { name: "보고서 준비 배치 포함", exact: true })
    .check();
  await page
    .getByRole("button", { name: "선택한 배치 승인", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "기존 일정이 변경됐습니다",
  );
  await expect(
    page.getByRole("heading", { name: "배치 저장 완료", exact: true }),
  ).toHaveCount(0);
});

test("a saved receipt can be reopened without approving again", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  let approvals = 0;
  await page.route("**/test-api/api/scheduling/tasks?*", (route) =>
    route.fulfill({ json: { entries: [], has_more: false } }),
  );
  await page.route("**/test-api/api/scheduling/plans/preview-1", (route) =>
    route.fulfill({
      json: {
        ...plan(),
        approved_at: "2026-11-10T03:01:00Z",
        approved_event_ids: ["block-1", "block-2"],
      },
    }),
  );
  page.on("request", (r) => {
    if (r.url().includes("/approve")) approvals++;
  });
  await page.goto("/planning?plan=preview-1");
  await expect(
    page.getByRole("heading", { name: "배치 저장 완료", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "선택한 배치 승인", exact: true }),
  ).toHaveCount(0);
  expect(approvals).toBe(0);
});

test("manual flexible tasks do not require fixed start and end times", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  await page.goto("/sources/new?mode=manual");
  await page
    .getByRole("textbox", { name: "일정명", exact: true })
    .fill("자동 배치할 일");
  await page.getByText("상세 설정", { exact: true }).click();
  await page.getByLabel("작업 유형", { exact: true }).selectOption("flexible");
  await page.getByLabel(/소요시간/).fill("90");
  const sent = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/api/tasks"),
  );
  await page.getByRole("button", { name: "일정 등록", exact: true }).click();
  expect((await sent).postDataJSON()).toMatchObject({
    schedule_type: "flexible",
    earliest_start: null,
    latest_end: null,
    estimated_minutes: 90,
  });
});
