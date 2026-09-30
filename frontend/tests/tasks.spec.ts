import { test, expect, type Page } from "@playwright/test";
import { login, mockApi } from "./fixtures";
import type { Deadline } from "../types/api";
import type { Task } from "../types/task";

const deadline: Deadline = {
  id: "deadline-1",
  title: "최종 발표",
  due_at: "2026-10-10T00:00:00Z",
  source_id: null,
  deadline_type: null,
  description: null,
  confidence: null,
  evidence_text: null,
  is_confirmed: true,
  created_at: "2026-09-30T00:00:00Z",
  updated_at: "2026-09-30T00:00:00Z",
};
const seedTask: Task = {
  id: "seed-task",
  title: "기존 작업",
  deadline_id: "deadline-1",
  description: "첫 번째 줄\n두 번째 줄",
  estimated_minutes: 60,
  priority: 3,
  schedule_type: "flexible",
  earliest_start: "2026-10-01T00:00:45.123Z",
  latest_end: "2026-10-01T02:00:10.456Z",
  is_completed: false,
  completed_at: null,
  created_at: "2026-09-30T00:00:00Z",
  updated_at: "2026-09-30T00:00:00Z",
};
async function seed(
  page: Page,
  tasks: Task[] = [],
  deadlines: Deadline[] = [deadline],
) {
  await mockApi(page, [], { tasks, deadlines });
}

test("deadline-linked task creation, detail, cancellation, completion and deletion", async ({
  page,
}) => {
  await seed(
    page,
    [
      {
        ...seedTask,
        id: "unrelated",
        title: "다른 마감의 작업",
        deadline_id: "deadline-2",
      },
    ],
    [deadline, { ...deadline, id: "deadline-2", title: "다른 마감" }],
  );
  await login(page);
  await page.goto("/deadlines/deadline-1");
  await expect(
    page.getByText("연결된 작업이 없습니다", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "다른 마감의 작업", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "＋ 작업 등록", exact: true }).click();
  await expect(page.getByLabel("연결할 마감일", { exact: true })).toHaveValue(
    "deadline-1",
  );
  await page.getByLabel("작업명", { exact: true }).fill("발표 초안 작성");
  await page.getByLabel("예상 소요시간 (분, 선택)").fill("90");
  await page.getByLabel("우선순위", { exact: true }).selectOption("2");
  await page.getByLabel("작업 유형", { exact: true }).selectOption("fixed");
  await page
    .getByLabel("가능 시작 일시 (한국 시간, 선택)")
    .fill("2026-10-01T09:00");
  await page
    .getByLabel("최종 완료 일시 (한국 시간, 선택)")
    .fill("2026-10-01T11:00");
  await page.getByLabel("작업 설명 (선택)").fill("슬라이드 초안을 준비합니다.");
  const create = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname.endsWith("/api/tasks"),
  );
  await page.getByRole("button", { name: "작업 등록", exact: true }).click();
  expect((await create).postDataJSON()).toEqual({
    title: "발표 초안 작성",
    deadline_id: "deadline-1",
    description: "슬라이드 초안을 준비합니다.",
    estimated_minutes: 90,
    priority: 2,
    schedule_type: "fixed",
    earliest_start: "2026-10-01T00:00:00.000Z",
    latest_end: "2026-10-01T02:00:00.000Z",
    is_completed: false,
  });
  await expect(page).toHaveURL(/\/tasks\/task-1$/);
  await page.getByRole("button", { name: "작업 수정", exact: true }).click();
  await page.getByLabel("작업명", { exact: true }).fill("취소할 수정");
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "발표 초안 작성", exact: true }),
  ).toBeVisible();
  const complete = page.waitForRequest(
    (request) => request.method() === "PATCH",
  );
  await page.getByRole("button", { name: "완료 처리", exact: true }).click();
  expect((await complete).postDataJSON()).toEqual({ is_completed: true });
  await expect(
    page.getByText("작업을 완료했습니다.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("완료 일시", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "연결된 마감일 보기" }).click();
  await expect(
    page.getByRole("link", { name: "발표 초안 작성", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "다른 마감의 작업", exact: true }),
  ).toHaveCount(0);
  const reopen = page.waitForRequest((request) => request.method() === "PATCH");
  await page
    .getByRole("button", { name: "발표 초안 작성 미완료로 변경", exact: true })
    .click();
  expect((await reopen).postDataJSON()).toEqual({ is_completed: false });
  await expect(
    page.getByRole("button", { name: "발표 초안 작성 완료 처리", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "발표 초안 작성", exact: true }).click();
  await page.getByRole("button", { name: "작업 삭제", exact: true }).click();
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "발표 초안 작성", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "작업 삭제", exact: true }).click();
  await page.getByRole("button", { name: "삭제 확인", exact: true }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(
    page.getByRole("link", { name: "발표 초안 작성", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "다른 마감의 작업", exact: true }),
  ).toBeVisible();
});

test("task editing preserves time precision and supports clearing optional fields", async ({
  page,
}) => {
  await seed(page, [seedTask]);
  await login(page);
  await page.goto("/tasks/seed-task");
  await page.getByRole("button", { name: "작업 수정", exact: true }).click();
  await page.getByLabel("작업명", { exact: true }).fill("제목만 변경");
  const update = page.waitForRequest((request) => request.method() === "PATCH");
  await page.getByRole("button", { name: "변경 사항 저장" }).click();
  const payload = (await update).postDataJSON();
  expect(payload.earliest_start).toBe(seedTask.earliest_start);
  expect(payload.latest_end).toBe(seedTask.latest_end);
  await expect(page.getByText("변경 사항을 저장했습니다.")).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "제목만 변경", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("task-detail.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "작업 수정", exact: true }).click();
  await page.getByLabel("연결할 마감일", { exact: true }).selectOption("");
  await page.getByLabel("예상 소요시간 (분, 선택)").fill("");
  await page.getByLabel("가능 시작 일시 (한국 시간, 선택)").fill("");
  await page.getByLabel("최종 완료 일시 (한국 시간, 선택)").fill("");
  await page.getByLabel("작업 설명 (선택)").fill("");
  const clear = page.waitForRequest((request) => request.method() === "PATCH");
  await page.getByRole("button", { name: "변경 사항 저장" }).click();
  expect((await clear).postDataJSON()).toMatchObject({
    deadline_id: null,
    estimated_minutes: null,
    earliest_start: null,
    latest_end: null,
    description: null,
  });
  await expect(page.getByText("변경 사항을 저장했습니다.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("연결된 마감일이 없습니다.")).toBeVisible();
});

test("list filters, pagination and completion update refresh matching results", async ({
  page,
}) => {
  const tasks = Array.from({ length: 52 }, (_, index) => ({
    ...seedTask,
    id: `page-task-${index}`,
    title: `페이지 작업 ${index}`,
    is_completed: index === 51,
    completed_at: index === 51 ? "2026-09-30T01:00:00Z" : null,
    schedule_type: index === 51 ? ("fixed" as const) : ("flexible" as const),
  }));
  await seed(page, tasks);
  await login(page);
  await page.getByRole("link", { name: "작업", exact: true }).click();
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "페이지 작업 50", exact: true }),
  ).toBeVisible();
  await page.getByLabel("완료 상태", { exact: true }).selectOption("true");
  await expect(page.getByText("1 페이지", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "페이지 작업 51", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "페이지 작업 50", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("작업 유형", { exact: true }).selectOption("fixed");
  await page
    .getByRole("button", { name: "페이지 작업 51 미완료로 변경", exact: true })
    .click();
  await expect(
    page.getByText("표시할 작업이 없습니다", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("완료 상태", { exact: true }).selectOption("false");
  await expect(
    page.getByRole("link", { name: "페이지 작업 51", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("task-list.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("deadline choices load all pages and invalid task input keeps the form", async ({
  page,
}) => {
  const deadlines = Array.from({ length: 101 }, (_, index) => ({
    ...deadline,
    id: `deadline-option-${index}`,
    title: `마감 ${index}`,
  }));
  await seed(page, [], deadlines);
  await login(page);
  await page.goto("/tasks/new");
  await page
    .getByLabel("연결할 마감일", { exact: true })
    .selectOption("deadline-option-100");
  await page.getByLabel("작업명", { exact: true }).fill("   ");
  await page.getByRole("button", { name: "작업 등록", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "작업명을 입력해 주세요." }),
  ).toBeVisible();
  await page.getByLabel("작업명", { exact: true }).fill("기간 검증");
  await page
    .getByLabel("가능 시작 일시 (한국 시간, 선택)")
    .fill("2026-10-01T11:00");
  await page
    .getByLabel("최종 완료 일시 (한국 시간, 선택)")
    .fill("2026-10-01T10:00");
  await page.getByRole("button", { name: "작업 등록", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({
      hasText: "최종 완료 일시는 가능 시작 일시보다 늦어야 합니다.",
    }),
  ).toBeVisible();
  await expect(page.getByLabel("작업명", { exact: true })).toHaveValue(
    "기간 검증",
  );
  await page.getByLabel("최종 완료 일시 (한국 시간, 선택)").fill("");
  await page.getByRole("button", { name: "작업 등록", exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\/task-1$/);
  await expect(page.getByText("연결된 마감일 보기 →")).toBeVisible();
});

test("completion and save failures preserve values and deletion conflict is explained", async ({
  page,
}) => {
  await seed(page, [seedTask]);
  await login(page);
  await page.goto("/tasks/seed-task");
  await page.route("**/test-api/api/tasks/seed-task", (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({ status: 500, json: { detail: "작업 저장 실패" } })
      : route.fallback(),
  );
  await page.getByRole("button", { name: "완료 처리", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "작업 저장 실패" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "완료 처리", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "작업 수정", exact: true }).click();
  await page.getByLabel("작업명", { exact: true }).fill("유지할 입력");
  await page.getByRole("button", { name: "변경 사항 저장" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "작업 저장 실패" }),
  ).toBeVisible();
  await expect(page.getByLabel("작업명", { exact: true })).toHaveValue(
    "유지할 입력",
  );
  await page.unroute("**/test-api/api/tasks/seed-task");
  await page.getByRole("button", { name: "변경 사항 저장" }).click();
  await expect(page.getByText("변경 사항을 저장했습니다.")).toBeVisible();
  await page.route("**/test-api/api/tasks/seed-task", (route) =>
    route.request().method() === "DELETE"
      ? route.fulfill({
          status: 409,
          json: {
            detail:
              "Synchronize linked calendar events before deleting this task",
          },
        })
      : route.fallback(),
  );
  await page.getByRole("button", { name: "작업 삭제", exact: true }).click();
  await page.getByRole("button", { name: "삭제 확인", exact: true }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "연결된 캘린더 일정이 있어 삭제할 수 없습니다." }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/tasks\/seed-task$/);
  await page.unroute("**/test-api/api/tasks/seed-task");
  await page.getByRole("button", { name: "삭제 확인", exact: true }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(
    page.getByText("표시할 작업이 없습니다", { exact: true }),
  ).toBeVisible();
});

test("task routes protect access and show missing record, API retry and expiration", async ({
  page,
}) => {
  await seed(page, [seedTask]);
  await page.goto("/tasks/new");
  await expect(page).toHaveURL(/\/login$/);
  await login(page);
  await page.goto("/tasks/missing");
  await expect(
    page.getByRole("alert").filter({ hasText: "작업을 찾을 수 없습니다." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "← 작업 목록" }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(
    page.getByRole("link", { name: "기존 작업", exact: true }),
  ).toBeVisible();
  await page.route("**/test-api/api/tasks?**", (route) =>
    route.fulfill({ status: 500, json: { detail: "작업 목록 오류" } }),
  );
  await page.reload();
  await expect(
    page.getByRole("alert").filter({ hasText: "작업 목록 오류" }),
  ).toBeVisible();
  await page.unroute("**/test-api/api/tasks?**");
  await page.getByRole("button", { name: "다시 시도" }).click();
  await expect(
    page.getByRole("link", { name: "기존 작업", exact: true }),
  ).toBeVisible();
  await page.route("**/test-api/api/tasks/seed-task", (route) =>
    route.fulfill({ status: 401, json: { detail: "Unauthorized" } }),
  );
  await page.goto("/tasks/seed-task");
  await expect(page).toHaveURL(/\/login$/);
  expect(
    await page.evaluate(() => sessionStorage.getItem("plancatch.access_token")),
  ).toBeNull();
});

test("deadline option error blocks submit and retries without losing task input", async ({
  page,
}) => {
  await seed(page);
  await login(page);
  await page.route("**/test-api/api/deadlines?**", (route) =>
    route.fulfill({ status: 500, json: { detail: "마감일 조회 실패" } }),
  );
  await page.goto("/tasks/new");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "마감일 목록을 불러오지 못했습니다." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "작업 등록", exact: true }),
  ).toBeDisabled();
  await page.unroute("**/test-api/api/deadlines?**");
  await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  await page.getByLabel("작업명", { exact: true }).fill("연결 없는 작업");
  await page.screenshot({
    path: test.info().outputPath("task-form.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "작업 등록", exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\/task-1$/);
  await expect(page.getByText("연결된 마감일이 없습니다.")).toBeVisible();
});
