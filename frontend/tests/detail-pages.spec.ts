import { expect, test } from "@playwright/test";
import { login, mockApi } from "./fixtures";
import { calendarTask } from "./calendar-fixtures";
import { aiSource } from "./analysis-fixtures";
import type { Deadline } from "../types/api";

const deadline: Deadline = {
  id: "detail-deadline",
  title: "[테스트] 보고서 마감",
  category: "study",
  due_at: "2026-12-03T08:00:45.123Z",
  safe_due_at: "2026-12-02T08:00:45.123Z",
  safety_buffer_minutes: 1440,
  source_id: aiSource.id,
  deadline_type: "과제",
  description: "[테스트] 제출 방법 메모",
  evidence_text: "[테스트] 12월 3일 17시까지 제출",
  confidence: 0.9,
  is_confirmed: true,
  created_at: "2026-11-27T00:00:00Z",
  updated_at: "2026-11-27T00:00:00Z",
};

test("마감일은 요약으로 열리고 수정 취소·오류·저장과 통합 카드 순서를 유지한다", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-11-27T03:00:00Z"));
  await mockApi(page, [aiSource], { deadlines: [deadline] });
  await page.route("**/api/deadlines/detail-deadline/readiness", (route) =>
    route.fulfill({
      json: {
        assessed_at: deadline.created_at,
        target_at: deadline.safe_due_at,
        uses_safety_deadline: true,
        status: "unknown",
        reasons: [],
        task_count: 0,
        completed_count: 0,
        unknown_task_count: 0,
        known_required_minutes: 0,
        required_minutes: null,
        planned_minutes: 0,
        unplanned_minutes: null,
        truncated: false,
      },
    }),
  );
  await login(page);
  await page.goto("/deadlines/detail-deadline");
  const summary = page.getByRole("region", {
    name: "마감일 요약",
    exact: true,
  });
  await expect(summary.getByText("D-6", { exact: true })).toBeVisible();
  await expect(summary.locator(".category-badge")).toHaveText("학업·과제");
  await expect(summary).toContainText(deadline.description!);
  await expect(page.getByLabel("마감 제목", { exact: true })).toHaveCount(0);
  const work = page.locator(".deadline-tasks");
  await expect(
    work.getByRole("heading", { name: "이 마감일의 할 일", exact: true }),
  ).toBeVisible();
  await expect(
    work.getByRole("link", { name: "AI 작업 계획 만들기", exact: true }),
  ).toHaveAttribute("href", "/deadlines/detail-deadline/plan");
  await expect(
    work.getByRole("link", { name: "＋ 할 일 등록", exact: true }),
  ).toHaveAttribute("href", "/tasks/new?deadline_id=detail-deadline");
  expect(
    await page
      .locator(
        ".deadline-detail-summary, .deadline-tasks, .deadline-readiness, [aria-label='구글 캘린더 자동 동기화'], .danger-zone",
      )
      .evaluateAll((items) =>
        items.map((item) =>
          item.classList.contains("deadline-detail-summary")
            ? "summary"
            : item.classList.contains("deadline-tasks")
              ? "tasks"
              : item.classList.contains("deadline-readiness")
                ? "readiness"
                : item.classList.contains("danger-zone")
                  ? "delete"
                  : "google",
        ),
      ),
  ).toEqual(["summary", "tasks", "readiness", "google", "delete"]);
  await summary.locator("summary").click();
  await expect(
    summary.getByRole("link", { name: "원본 자료 보기 →", exact: true }),
  ).toHaveAttribute("href", "/sources/ai-source");
  await summary.getByRole("button", { name: "수정", exact: true }).click();
  await page
    .getByLabel("마감 제목", { exact: true })
    .fill("[테스트] 저장 전 변경");
  page.once("dialog", (dialog) => dialog.dismiss());
  await summary.getByRole("button", { name: "취소", exact: true }).click();
  await expect(page.getByLabel("마감 제목", { exact: true })).toHaveValue(
    "[테스트] 저장 전 변경",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await summary.getByRole("button", { name: "취소", exact: true }).click();
  await expect(
    summary.getByRole("heading", { name: deadline.title, exact: true }),
  ).toBeVisible();
  await summary.getByRole("button", { name: "수정", exact: true }).click();
  await page
    .getByLabel("마감 제목", { exact: true })
    .fill("[테스트] 최종 마감");
  await page.route("**/api/deadlines/detail-deadline", (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({ status: 500, json: { detail: "[테스트] 저장 실패" } })
      : route.fallback(),
  );
  await page
    .getByRole("button", { name: "변경 사항 저장", exact: true })
    .click();
  await expect(summary.getByRole("alert")).toContainText("[테스트] 저장 실패");
  await expect(page.getByLabel("마감 제목", { exact: true })).toHaveValue(
    "[테스트] 최종 마감",
  );
  await page.unroute("**/api/deadlines/detail-deadline");
  const update = page.waitForRequest((r) => r.method() === "PATCH");
  await page
    .getByRole("button", { name: "변경 사항 저장", exact: true })
    .click();
  expect((await update).postDataJSON()).toMatchObject({
    due_at: deadline.due_at,
    safety_buffer_minutes: 1440,
    source_id: aiSource.id,
  });
  await expect(
    summary.getByRole("button", { name: "수정", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("마감 제목", { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(summary.locator(".category-badge")).toHaveText("학업·과제");
  await expect(
    summary.getByRole("heading", { name: "[테스트] 최종 마감", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("deadline-detail-view.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 320, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("할 일 빠른 완료는 중복 요청을 막고 실패 후 재시도·미완료·삭제 이동을 처리한다", async ({
  page,
}) => {
  await mockApi(page, [], {
    tasks: [
      {
        ...calendarTask,
        category: "work",
        recurrence: null,
        google_reminders: { mode: "none", overrides: [] },
      },
    ],
  });
  await login(page);
  await page.goto("/tasks/" + calendarTask.id);
  const card = page.locator(".task-detail");
  await expect(card.locator(".category-badge")).toHaveText("업무·프로젝트");
  await expect(card.locator(".schedule-window-note")).toHaveCount(0);
  await expect(
    card.getByText("반복: 반복 안 함", { exact: true }),
  ).not.toBeVisible();
  await expect(
    card.getByText("구글 캘린더 알림: 알림 없음", { exact: true }),
  ).not.toBeVisible();
  await card.locator("summary").click();
  await expect(
    card.getByText("반복: 반복 안 함", { exact: true }),
  ).toBeVisible();
  await card.locator("summary").click();
  let calls = 0,
    release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/tasks/" + calendarTask.id, async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    calls++;
    await wait;
    await route.fulfill({
      status: 500,
      json: { detail: "[테스트] 완료 변경 실패" },
    });
  });
  try {
    await card
      .getByRole("button", { name: "완료 처리", exact: true })
      .evaluate((button: HTMLButtonElement) => {
        button.click();
        button.click();
      });
    await expect.poll(() => calls).toBe(1);
    await expect(
      card.getByRole("button", { name: "변경 중…", exact: true }),
    ).toBeDisabled();
  } finally {
    release();
  }
  await expect(
    page.getByRole("alert").filter({ hasText: "[테스트] 완료 변경 실패" }),
  ).toBeVisible();
  await expect(card.getByText("미완료", { exact: true })).toBeVisible();
  await page.unroute("**/api/tasks/" + calendarTask.id);
  const update = page.waitForRequest((r) => r.method() === "PATCH");
  await card.getByRole("button", { name: "완료 처리", exact: true }).click();
  expect((await update).postDataJSON()).toEqual({ is_completed: true });
  await card
    .getByRole("button", { name: "미완료로 변경", exact: true })
    .click();
  await expect(
    card.getByRole("button", { name: "완료 처리", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "다크 모드로 전환", exact: true })
    .click();
  await expect(card).toHaveCSS("background-color", "rgb(28, 38, 54)");
  await page.screenshot({
    path: test.info().outputPath("task-detail-view-dark.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("link", { name: "← 마감일·할 일 목록", exact: true })
    .click();
  await expect(page).toHaveURL(/\/deadlines$/);
  await page.goto("/tasks/" + calendarTask.id);
  await page.getByRole("button", { name: "일정 삭제", exact: true }).click();
  await page.getByRole("button", { name: "삭제 확인", exact: true }).click();
  await expect(page).toHaveURL(/\/deadlines$/);
});
