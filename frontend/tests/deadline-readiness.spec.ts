import { test, expect } from "@playwright/test";
import { login, mockApi } from "./fixtures";
import type { Deadline } from "../types/api";
import type { Task } from "../types/task";

const deadline: Deadline = {
  id: "readiness-deadline",
  title: "보고서 제출",
  due_at: "2026-11-20T09:00:00Z",
  safe_due_at: "2026-11-19T09:00:00Z",
  safety_buffer_minutes: 1440,
  source_id: null,
  deadline_type: null,
  description: null,
  confidence: null,
  evidence_text: null,
  is_confirmed: true,
  created_at: "2026-11-10T00:00:00Z",
  updated_at: "2026-11-10T00:00:00Z",
};
const task: Task = {
  id: "readiness-work",
  deadline_id: deadline.id,
  title: "보고서 작성",
  description: null,
  earliest_start: null,
  latest_end: null,
  estimated_minutes: 120,
  priority: 3,
  schedule_type: "flexible",
  is_completed: false,
  completed_at: null,
  created_at: deadline.created_at,
  updated_at: deadline.updated_at,
};
const report = {
  assessed_at: "2026-11-10T03:00:00Z",
  target_at: deadline.safe_due_at,
  uses_safety_deadline: true,
  status: "attention",
  reasons: ["목표 시각 전 배치 시간이 부족합니다."],
  task_count: 1,
  completed_count: 0,
  unknown_task_count: 0,
  known_required_minutes: 120,
  required_minutes: 120,
  planned_minutes: 60,
  unplanned_minutes: 60,
  truncated: false,
};

test("read-only server assessment displays Korean status, safety date and work times", async ({
  page,
}) => {
  await mockApi(page, [], { deadlines: [deadline], tasks: [task] });
  let reads = 0;
  await page.route("**/readiness-deadline/readiness", (route) => {
    expect(route.request().method()).toBe("GET");
    reads++;
    return route.fulfill({ json: report });
  });
  await login(page);
  await page.goto(`/deadlines/${deadline.id}`);
  const panel = page.getByRole("region", { name: "마감 준비 상태" });
  await expect(panel.getByText("확인 필요", { exact: true })).toBeVisible();
  await expect(panel).toContainText("안전 마감 기준");
  await expect(panel).toContainText("2026. 11. 19. 오후 6:00");
  await expect(panel.getByText("2시간", { exact: true })).toBeVisible();
  await expect(panel).toContainText("다른 작업과 구글 개인 일정의 겹침은");
  await panel.getByRole("button", { name: "다시 확인" }).click();
  await expect(panel.getByText("확인 필요", { exact: true })).toBeVisible();
  expect(reads).toBe(2);
  await expect(
    panel.getByRole("link", { name: "자동 배치로 시간 확인 →" }),
  ).toHaveAttribute("href", "/planning");
  await page.getByRole("button", { name: "다크 모드로 전환" }).click();
  await panel.screenshot({
    path: test.info().outputPath("readiness-dark.png"),
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("completing linked work refreshes preparation without saving the deadline again", async ({
  page,
}) => {
  await mockApi(page, [], { deadlines: [deadline], tasks: [task] });
  let reads = 0;
  await page.route("**/readiness-deadline/readiness", (route) => {
    reads++;
    return route.fulfill({
      json:
        reads === 1
          ? report
          : {
              ...report,
              status: "completed",
              required_minutes: 0,
              completed_count: 1,
              planned_minutes: 0,
              unplanned_minutes: 0,
              reasons: ["연결된 할 일이 모두 완료로 표시되어 있습니다."],
            },
    });
  });
  await login(page);
  await page.goto(`/deadlines/${deadline.id}`);
  const panel = page.getByRole("region", { name: "마감 준비 상태" });
  await expect(panel.getByText("확인 필요", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "보고서 작성 완료 처리" }).click();
  await expect(panel.getByText("할 일 완료", { exact: true })).toBeVisible();
  expect(reads).toBe(2);
});

test("missing information and bounded partial checks do not display zero remaining work", async ({
  page,
}) => {
  await mockApi(page, [], { deadlines: [deadline] });
  await page.route("**/readiness-deadline/readiness", (route) =>
    route.fulfill({
      json: {
        ...report,
        status: "unknown",
        required_minutes: null,
        unplanned_minutes: null,
        truncated: true,
        reasons: ["할 일이 많아 일부만 확인했습니다."],
      },
    }),
  );
  await login(page);
  await page.goto(`/deadlines/${deadline.id}`);
  const panel = page.getByRole("region", { name: "마감 준비 상태" });
  await expect(panel.getByText("정보 부족", { exact: true })).toBeVisible();
  await expect(panel).toContainText("미정 (확인된 시간 2시간)");
  await expect(panel).toContainText("정보 확인 필요");
  await expect(panel).toContainText("일부만 확인했습니다");
});

test("saving a changed deadline refreshes its preparation assessment", async ({
  page,
}) => {
  await mockApi(page, [], { deadlines: [deadline], tasks: [task] });
  let reads = 0;
  await page.route("**/readiness-deadline/readiness", (route) => {
    reads++;
    return route.fulfill({
      json:
        reads === 1
          ? report
          : {
              ...report,
              status: "planned",
              reasons: ["변경한 목표 시각으로 확인했습니다."],
            },
    });
  });
  await login(page);
  await page.goto(`/deadlines/${deadline.id}`);
  const panel = page.getByRole("region", { name: "마감 준비 상태" });
  await expect(panel.getByText("확인 필요", { exact: true })).toBeVisible();
  await page.getByLabel("마감 제목", { exact: true }).fill("수정한 보고서");
  await page
    .getByRole("button", { name: "변경 사항 저장", exact: true })
    .click();
  await expect(panel.getByText("계획 있음", { exact: true })).toBeVisible();
  expect(reads).toBe(2);
});

test("failed assessment keeps the editable form and retries without showing old success", async ({
  page,
}) => {
  await mockApi(page, [], { deadlines: [deadline] });
  let reads = 0;
  await page.route("**/readiness-deadline/readiness", (route) => {
    reads++;
    if (reads === 2)
      return route.fulfill({
        status: 503,
        json: { detail: "준비 상태를 확인하지 못했습니다." },
      });
    return route.fulfill({
      json: {
        ...report,
        status: "planned",
        reasons: ["확인한 할 일의 배치가 있습니다."],
      },
    });
  });
  await login(page);
  await page.goto(`/deadlines/${deadline.id}`);
  const panel = page.getByRole("region", { name: "마감 준비 상태" });
  await expect(panel.getByText("계획 있음", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "다시 확인" }).click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await expect(panel.getByText("계획 있음", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("마감 제목", { exact: true })).toBeEnabled();
  await panel.getByRole("button", { name: "다시 확인" }).click();
  await expect(panel.getByText("계획 있음", { exact: true })).toBeVisible();
});
