import { test, expect, type Page } from "@playwright/test";
import { login, mockApi } from "./fixtures";
import { calendarTask } from "./calendar-fixtures";

const region = (page: Page) =>
  page.getByRole("region", { name: "Google 자동 동기화", exact: true });
type State =
  | "not_connected"
  | "pending"
  | "retrying"
  | "failed"
  | "synced"
  | "ready"
  | "deleted"
  | "not_scheduled";
async function setup(page: Page, initial: State = "synced") {
  await mockApi(page, [], { tasks: [calendarTask] });
  let state = initial,
    reads = 0,
    posts = 0,
    failed = false;
  const bodies: unknown[] = [];
  await page.route(/\/auto-sync(?:\?|$)/, async (route) => {
    if (route.request().method() === "POST") {
      posts++;
      bodies.push(route.request().postDataJSON());
      if (failed)
        return route.fulfill({
          status: 503,
          json: { detail: "연결을 다시 확인해 주세요." },
        });
      state = "pending";
      return route.fulfill({
        status: 202,
        json: { state: "pending", note: "반영 요청" },
      });
    }
    reads++;
    return route.fulfill({
      json: {
        state,
        note:
          state === "synced"
            ? "Google 캘린더에 반영되었습니다."
            : state === "pending"
              ? "Google 캘린더에 반영 중입니다."
              : state === "retrying"
                ? "자동으로 다시 시도합니다."
                : state === "not_connected"
                  ? "Google 계정을 연결해 주세요."
                  : state === "deleted"
                    ? "Google 캘린더에서도 삭제되었습니다."
                    : state === "not_scheduled"
                      ? "실제 시간을 지정하면 자동 반영됩니다."
                      : "Google 연결과 반영 상태를 확인해 주세요.",
        retryable: state === "failed" || state === "ready",
      },
    });
  });
  await login(page);
  await page.goto("/tasks/" + calendarTask.id);
  await expect(region(page).getByRole("status")).toBeVisible();
  return {
    setState: (value: State) => {
      state = value;
    },
    fail: () => {
      failed = true;
    },
    reads: () => reads,
    posts: () => posts,
    bodies,
  };
}

test("automatic status replaces previews and task detail completion button", async ({
  page,
}) => {
  const state = await setup(page);
  await expect(
    page.getByRole("button", { name: "완료 처리", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "미완료로 변경", exact: true }),
  ).toHaveCount(0);
  await expect(region(page).getByRole("status")).toContainText(
    "반영되었습니다",
  );
  await expect(region(page).getByRole("button")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /미리보기|캘린더 등록/ }),
  ).toHaveCount(0);
  expect(state.posts()).toBe(0);
});

test("pending status polls to completion without confirmation requests", async ({
  page,
}) => {
  const state = await setup(page, "pending");
  state.setState("synced");
  await expect(region(page).getByRole("status")).toContainText(
    "반영되었습니다",
    { timeout: 7000 },
  );
  expect(state.reads()).toBeGreaterThan(1);
  expect(state.posts()).toBe(0);
});

for (const kind of [
  "not_connected",
  "deleted",
  "not_scheduled",
  "retrying",
] as const) {
  test(`${kind} does not offer manual export or confirmation`, async ({
    page,
  }) => {
    const state = await setup(page, kind);
    await expect(region(page).getByRole("button")).toHaveCount(0);
    expect(state.posts()).toBe(0);
    await expect(
      region(page).getByRole("link", { name: "Google 계정 연결 확인 →" }),
    ).toBeVisible();
  });
}

for (const initial of ["ready", "failed"] as const) {
  test(`${initial} recovery queues once with no extra confirmation`, async ({
    page,
  }) => {
    const state = await setup(page, initial);
    await region(page)
      .getByRole("button", {
        name: initial === "ready" ? "지금 동기화" : "다시 시도",
        exact: true,
      })
      .click();
    await expect(region(page).getByRole("status")).toContainText("반영 중");
    expect(state.posts()).toBe(1);
    expect(state.bodies).toEqual([{ kind: "task", item_id: calendarTask.id }]);
    state.setState("synced");
    await expect(region(page).getByRole("status")).toContainText(
      "반영되었습니다",
      { timeout: 7000 },
    );
  });
}

test("retry failure keeps local schedule and allows recovery", async ({
  page,
}) => {
  const state = await setup(page, "failed");
  state.fail();
  await region(page)
    .getByRole("button", { name: "다시 시도", exact: true })
    .click();
  await expect(region(page).getByRole("alert")).toContainText(
    "연결을 다시 확인",
  );
  await expect(
    page.getByRole("heading", { name: calendarTask.title, exact: true }),
  ).toBeVisible();
  await expect(
    region(page).getByRole("button", { name: "다시 시도", exact: true }),
  ).toBeEnabled();
});

test("status request failure is an error instead of a false synchronization success", async ({
  page,
}) => {
  await mockApi(page, [], { tasks: [calendarTask] });
  await page.route(/\/auto-sync(?:\?|$)/, (route) =>
    route.fulfill({ status: 503, json: { detail: "상태 확인 실패" } }),
  );
  await login(page);
  await page.goto("/tasks/" + calendarTask.id);
  await expect(region(page).getByRole("alert")).toContainText("상태 확인 실패");
  await expect(
    region(page).getByText("Google 캘린더에 반영되었습니다.", { exact: true }),
  ).toHaveCount(0);
});

test("new connection explanation describes future automatic changes", async ({
  page,
}) => {
  await mockApi(page);
  await page.route("**/google-calendar/status", (route) =>
    route.fulfill({
      json: {
        configured: true,
        connected: false,
        pending: false,
        reconnect_required: false,
        connected_at: null,
        scopes: [],
      },
    }),
  );
  await login(page);
  await page.goto("/settings/google-calendar");
  await expect(
    page.getByText(/플랜캐치에서 등록·수정·삭제하는 일정이 Google 캘린더에 자동으로 반영/),
  ).toBeVisible();
  await expect(
    page.getByText(/다른 앱에서 만든 Google 일정은 변경하지/),
  ).toBeVisible();
});
