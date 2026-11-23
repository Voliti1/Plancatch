import { expect, test, type Page } from "@playwright/test";
import { login, mockApi } from "./fixtures";
import type { Availability } from "../features/calendar/availability-page";

async function setup(page: Page) {
  await mockApi(page);
  let saved: Availability = {
    revision: 0,
    timezone: "Asia/Seoul",
    exceptions: [],
    weekly: Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      intervals: weekday < 5 ? [{ start_minutes: 540, end_minutes: 1080 }] : [],
    })),
  };
  const state = { puts: 0, conflict: false };
  await page.route("**/test-api/api/scheduling/availability", (route) => {
    if (route.request().method() === "PUT") {
      state.puts++;
      const body = route.request().postDataJSON() as Availability;
      if (state.conflict)
        return route.fulfill({
          status: 409,
          json: {
            detail:
              "다른 화면에서 설정이 변경됐습니다. 다시 불러온 뒤 저장해 주세요.",
          },
        });
      expect(body.revision).toBe(saved.revision);
      saved = { ...body, revision: saved.revision + 1 };
    }
    return route.fulfill({ json: saved });
  });
  await login(page);
  await page.goto("/planning/availability");
  await expect(
    page.getByRole("heading", { name: "작업 가능한 시간" }),
  ).toBeVisible();
  await expect(page.getByLabel("월요일 1 시작", { exact: true })).toHaveValue(
    "09:00",
  );
  return state;
}

test("saved weekly hours and date exception survive navigation and enable account hours", async ({
  page,
}) => {
  const state = await setup(page);
  await page.getByLabel("월요일 1 시작", { exact: true }).fill("10:30");
  await page.getByLabel("예외 날짜", { exact: true }).fill("2026-11-18");
  await page.getByRole("button", { name: "날짜 추가", exact: true }).click();
  await page
    .getByRole("button", { name: "2026-11-18 시간 추가", exact: true })
    .click();
  await page.getByLabel("2026-11-18 1 종료", { exact: true }).fill("00:00");
  await page
    .getByRole("button", { name: "가능 시간 저장", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "가능 시간을 저장했습니다",
  );
  expect(state.puts).toBe(1);
  await page.screenshot({
    path: `test-results/availability-${test.info().project.name}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.getByRole("link", { name: "이 조건으로 시간 추천받기" }).click();
  await page.getByText("추천 조건", { exact: true }).click();
  await expect(
    page.getByText(/저장한 가능 시간과 날짜별 예외 적용 중/),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "하루 작업 시작", exact: true }),
  ).toBeEnabled();
  await page.getByRole("link", { name: "가능 시간 설정", exact: true }).click();
  await expect(page.getByLabel("월요일 1 시작", { exact: true })).toHaveValue(
    "10:30",
  );
  await expect(
    page.getByLabel("2026-11-18 1 종료", { exact: true }),
  ).toHaveValue("00:00");
  await page.getByRole("button", { name: "2026-11-18 예외 삭제" }).click();
  await page
    .getByRole("button", { name: "가능 시간 저장", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "가능 시간을 저장했습니다",
  );
});

test("stale save preserves draft and reload can discard it deliberately", async ({
  page,
}) => {
  const state = await setup(page);
  state.conflict = true;
  await page.getByLabel("월요일 1 시작", { exact: true }).fill("11:00");
  await page
    .getByRole("button", { name: "가능 시간 저장", exact: true })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "다른 화면에서 설정이 변경됐습니다" }),
  ).toContainText("다른 화면에서 설정이 변경됐습니다");
  await expect(page.getByLabel("월요일 1 시작", { exact: true })).toHaveValue(
    "11:00",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "설정 다시 불러오기" }).click();
  await expect(page.getByLabel("월요일 1 시작", { exact: true })).toHaveValue(
    "09:00",
  );
  expect(state.puts).toBe(1);
});

test("presets preview before applying; bulk edits keep exceptions and save explicit rest days", async ({
  page,
}) => {
  const state = await setup(page);
  await page.getByRole("button", { name: "날짜 추가", exact: true }).click();
  await page.getByLabel("기본 시간 프리셋").selectOption("evening");
  await expect(page.getByText(/월~금 18:00~22:00/)).toBeVisible();
  await expect(page.getByLabel("월요일 1 시작", { exact: true })).toHaveValue(
    "09:00",
  );
  expect(state.puts).toBe(0);
  await page.getByRole("button", { name: "이 기본 시간 적용" }).click();
  await expect(page.getByLabel("월요일 1 시작", { exact: true })).toHaveValue(
    "18:00",
  );
  await expect(
    page.getByRole("group", { name: "일요일", exact: true }),
  ).toContainText("휴식일");
  await page.getByText("여러 요일에 같은 시간 적용", { exact: true }).click();
  await page.getByRole("checkbox", { name: "월요일", exact: true }).check();
  await page.getByRole("checkbox", { name: "화요일", exact: true }).check();
  await page.getByLabel("일괄 적용 시작").fill("19:00");
  await page.getByLabel("일괄 적용 종료").fill("21:00");
  await page.getByRole("button", { name: "선택한 요일에 적용" }).click();
  await expect(page.getByLabel("화요일 1 시작", { exact: true })).toHaveValue(
    "19:00",
  );
  await expect(page.getByLabel("수요일 1 시작", { exact: true })).toHaveValue(
    "18:00",
  );
  await page
    .getByRole("button", { name: "가능 시간 저장", exact: true })
    .click();
  await expect(page.getByText(/가능 시간을 저장했습니다/)).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("group", { name: "일요일", exact: true }),
  ).toContainText("휴식일");
  await expect(page.getByRole("button", { name: /예외 삭제/ })).toBeVisible();
});

test("automatic preview explicitly uses account hours when selected", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/test-api/api/scheduling/tasks?*", (route) =>
    route.fulfill({
      json: {
        entries: [
          {
            id: "available-task",
            title: "가능 시간 검사",
            schedule_type: "flexible",
            estimated_minutes: 60,
            priority: 3,
            earliest_start: null,
            latest_end: null,
            deadline_id: null,
            is_completed: false,
          },
        ],
        has_more: false,
      },
    }),
  );
  let usesSaved = false;
  await page.route("**/test-api/api/scheduling/preview", (route) => {
    const body = route.request().postDataJSON();
    usesSaved = body.use_saved_availability === true;
    return route.fulfill({
      status: 201,
      json: {
        id: "availability-preview",
        request: body,
        blocks: [],
        expires_at: "2099-01-01T00:00:00Z",
        approved_at: null,
        approved_event_ids: [],
        details: {
          blocked: false,
          warnings: [],
          google_state: "not_connected",
          tasks: [],
          unplaced: [],
          use_saved_availability: true,
        },
      },
    });
  });
  await page.getByRole("link", { name: "이 조건으로 시간 추천받기" }).click();
  await page.getByRole("checkbox", { name: /가능 시간 검사/ }).check();
  await page
    .getByRole("button", { name: "추천 시간 보기", exact: true })
    .click();
  await expect.poll(() => usesSaved).toBe(true);
});

test("leaving unsaved working hours asks before discarding", async ({
  page,
}) => {
  await setup(page);
  await page.getByLabel("월요일 1 시작", { exact: true }).fill("11:00");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "이 조건으로 시간 추천받기" }).click();
  await expect(page).toHaveURL(/\/planning\/availability$/);
  await expect(page.getByLabel("월요일 1 시작", { exact: true })).toHaveValue(
    "11:00",
  );
});
