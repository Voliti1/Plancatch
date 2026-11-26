import { expect, test, type Page } from "@playwright/test";
import { login, mockApi } from "./fixtures";

async function setup(page: Page) {
  await mockApi(page);
  const state = {
    generated: 0,
    patched: 0,
    approved: 0,
    loseApproval: false,
    rejectApproval: false,
  };
  let proposal = {
    id: "proposal-1",
    revision: 1,
    status: "ready",
    created_at: "2026-11-17T00:00:00Z",
    warnings: ["AI 예상 작업이에요."],
    approved_task_ids: [] as string[],
    candidates: [
      {
        id: "first",
        title: "자료 조사",
        description: "자료 정리",
        estimated_minutes: 60,
        priority: 2,
        latest_end: "2026-11-29T09:00:00Z",
        selected: true,
        depends_on: [] as string[],
      },
      {
        id: "second",
        title: "최종 검토",
        description: "검토",
        estimated_minutes: 60,
        priority: 5,
        latest_end: "2026-11-30T09:00:00Z",
        selected: true,
        depends_on: ["first"],
      },
    ],
  };
  await page.route("**/test-api/api/deadlines/plan-deadline**", (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/task-proposals")) {
      if (route.request().method() === "POST") {
        expect(route.request().postDataJSON().allow_external_ai).toBe(true);
        state.generated++;
        return route.fulfill({ status: 201, json: proposal });
      }
      return route.fulfill({
        json: { entries: state.generated ? [proposal] : [], has_more: false },
      });
    }
    return route.fulfill({
      json: {
        id: "plan-deadline",
        title: "보고서 제출",
        due_at: "2026-11-30T09:00:00Z",
        safe_due_at: null,
      },
    });
  });
  await page.route("**/test-api/api/task-proposals/proposal-1**", (route) => {
    const method = route.request().method(),
      path = new URL(route.request().url()).pathname;
    if (method === "PATCH") {
      state.patched++;
      proposal = {
        ...proposal,
        candidates: route.request().postDataJSON().candidates,
        revision: proposal.revision + 1,
      };
    }
    if (path.endsWith("/approve")) {
      state.approved++;
      if (state.rejectApproval)
        return route.fulfill({
          status: 409,
          json: {
            detail: "마감일 정보가 바뀌었어요. 새 제안을 만들어 주세요.",
          },
        });
      proposal = {
        ...proposal,
        status: "approved",
        approved_task_ids: ["task-a", "task-b"],
      };
      if (state.loseApproval)
        return route.fulfill({
          status: 502,
          json: { detail: "응답 유실 검사" },
        });
    }
    return route.fulfill({ json: proposal });
  });
  await login(page);
  await page.goto("/deadlines/plan-deadline/plan");
  await expect(
    page.getByRole("heading", { name: "마감일까지 작업 계획" }),
  ).toBeVisible();
  return state;
}

async function generate(page: Page) {
  await expect(
    page.getByRole("button", { name: "AI 제안한 할 일 만들기" }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", { name: /AI\(구글 Gemini\)에 전송/ })
    .check();
  await page.getByRole("button", { name: "AI 제안한 할 일 만들기" }).click();
  await expect(
    page.getByRole("heading", { name: "제안한 할 일 검토" }),
  ).toBeVisible();
}

test("consent, editable candidates and one-click review approval", async ({
  page,
}) => {
  const state = await setup(page);
  await page
    .getByLabel("계획에 참고할 메모 (선택)")
    .fill("조사와 검토가 필요해요");
  await generate(page);
  await page
    .getByLabel("작업 제목", { exact: true })
    .first()
    .fill("수정한 조사");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: `test-results/task-plan-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "선택한 작업 등록" }).click();
  await expect(page.getByRole("status")).toContainText(
    "할 일 2개와 작업 순서를 등록했어요",
  );
  expect(state.generated).toBe(1);
  expect(state.patched).toBe(1);
  expect(state.approved).toBe(1);
  await expect(
    page.getByRole("link", { name: "자동 시간 추천으로 이동" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});

test("lost approval response recovers its receipt without duplicate submission", async ({
  page,
}) => {
  const state = await setup(page);
  state.loseApproval = true;
  await generate(page);
  await page.getByRole("button", { name: "선택한 작업 등록" }).click();
  await expect(page.getByRole("status")).toContainText("할 일 2개");
  expect(state.approved).toBe(1);
  expect(state.generated).toBe(1);
});

test("changed deadline error preserves saved review and does not report success", async ({
  page,
}) => {
  const state = await setup(page);
  state.rejectApproval = true;
  await generate(page);
  await page
    .getByLabel("작업 제목", { exact: true })
    .first()
    .fill("보존할 수정");
  await page.getByRole("button", { name: "선택한 작업 등록" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "마감일 정보가 바뀌었어요" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("작업 제목", { exact: true }).first(),
  ).toHaveValue("보존할 수정");
  await expect(
    page.getByRole("link", { name: "자동 시간 추천으로 이동" }),
  ).toHaveCount(0);
});
