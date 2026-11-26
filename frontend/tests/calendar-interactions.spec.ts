import { expect, test } from "@playwright/test";
import { calendarTask } from "./calendar-fixtures";
import { login, mockApi } from "./fixtures";

const task = {
  ...calendarTask,
  id: "calendar-action-task",
  title: "이동할 회의",
  description: "회의실 확인",
  earliest_start: "2026-11-23T00:00:00Z",
  latest_end: "2026-11-23T01:00:00Z",
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("plancatch.calendar.view"))
      localStorage.setItem("plancatch.calendar.view", "day");
  });
});

test("editing the default color updates only items using the default and persists it", async ({
  page,
}) => {
  const custom = { ...task, id: "custom-color-task", title: "개별 색상 회의" };
  await mockApi(page, [], { tasks: [task, custom] });
  await login(page);
  await page.goto("/calendar?date=2026-11-23");
  const defaultCard = page
    .locator(".time-event")
    .filter({ hasText: task.title });
  const customCard = page
    .locator(".time-event")
    .filter({ hasText: custom.title });
  await customCard.click();
  await page.getByRole("button", { name: "색상 변경", exact: true }).click();
  await page.getByRole("button", { name: "청록" }).click();
  await page.getByRole("button", { name: "닫기" }).click();
  await defaultCard.click();
  await page.getByRole("button", { name: "색상 변경", exact: true }).click();
  await expect(page.getByLabel("현재 기본 색상: 파랑")).toBeVisible();
  await page.getByRole("button", { name: "기본 색상 수정" }).click();
  await page
    .getByRole("group", { name: "할 일 기본 색상" })
    .getByRole("button", { name: "보라" })
    .click();
  await expect(page.getByLabel("현재 기본 색상: 보라")).toBeVisible();
  await page.getByRole("button", { name: "닫기" }).click();
  await expect(defaultCard).toHaveCSS("background-color", "rgb(112, 69, 165)");
  await expect(customCard).toHaveCSS("background-color", "rgb(23, 111, 107)");
  await page.reload();
  await expect(defaultCard).toHaveCSS("background-color", "rgb(112, 69, 165)");
  await customCard.click();
  await page.getByRole("button", { name: "색상 변경", exact: true }).click();
  await page.getByRole("button", { name: "기본 색상", exact: true }).click();
  await page.getByRole("button", { name: "닫기" }).click();
  await expect(customCard).toHaveCSS("background-color", "rgb(112, 69, 165)");
});

test("narrow overlapping weekly cards wrap the title and show both times", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  const long = { ...task, title: "프로젝트 회의" };
  const parallel = { ...task, id: "parallel-task", title: "겹친 일정" };
  await mockApi(page, [], { tasks: [long, parallel] });
  await login(page);
  await page.goto("/calendar?date=2026-11-23");
  await page.getByRole("button", { name: "주간", exact: true }).click();
  const card = page.locator(".time-event").filter({ hasText: long.title });
  const title = card.locator(".time-event-title");
  const hours = card.locator(".time-event-clock > span");
  await expect(title).toHaveCSS("white-space", "normal");
  await expect(hours.first()).toHaveText("09:00");
  await expect(hours.last()).toContainText("10:00");
  const first = (await hours.first().boundingBox())!;
  const last = (await hours.last().boundingBox())!;
  const block = (await card.boundingBox())!;
  expect(last.y).toBeGreaterThan(first.y);
  expect(last.y + last.height).toBeLessThanOrEqual(block.y + block.height);
  expect((await title.boundingBox())!.height).toBeGreaterThan(18);
});

test("calendar details, edit, duplicate, persistent color and confirmed deletion", async ({
  page,
}) => {
  await mockApi(page, [], { tasks: [task] });
  await login(page);
  await page.goto("/calendar?date=2026-11-23");
  const blocks = page.locator(".time-event").filter({ hasText: task.title });
  await blocks.first().click();
  const dialog = page.getByRole("dialog", { name: task.title });
  await expect(dialog.getByText(task.description)).toBeVisible();
  await expect(dialog.getByRole("link", { name: "수정" })).toHaveAttribute(
    "href",
    /tasks\/calendar-action-task\?edit=1$/,
  );
  await dialog.getByRole("button", { name: "색상 변경" }).click();
  await dialog.getByRole("button", { name: "청록" }).click();
  await dialog.getByRole("button", { name: "닫기" }).click();
  await expect(blocks.first()).toHaveCSS(
    "background-color",
    "rgb(23, 111, 107)",
  );
  await page.reload();
  await expect(blocks.first()).toHaveCSS(
    "background-color",
    "rgb(23, 111, 107)",
  );

  await blocks.first().click();
  const copied = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/api/tasks"),
  );
  await dialog.getByRole("button", { name: "복제" }).click();
  expect((await copied).postDataJSON()).toMatchObject({
    title: task.title,
    description: task.description,
    earliest_start: task.earliest_start,
    latest_end: task.latest_end,
    recurrence: null,
  });
  await expect(blocks).toHaveCount(2);
  if (test.info().project.name === "desktop") {
    await blocks.first().click({ button: "right" });
    await expect(
      dialog.getByRole("group", { name: "일정 색상" }),
    ).toBeVisible();
  } else {
    await blocks.first().click();
  }
  await dialog.getByRole("button", { name: "삭제", exact: true }).click();
  await expect(blocks).toHaveCount(2);
  await dialog.getByRole("button", { name: "삭제 확인" }).click();
  await expect(blocks).toHaveCount(1);
});

test("dragging snaps to a quarter hour on the same day and a different day", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "Uses an actual mouse");
  await mockApi(page, [], { tasks: [task] });
  await login(page);
  await page.goto("/calendar?date=2026-11-23");
  await page.getByRole("button", { name: "주간", exact: true }).click();
  const grid = page.getByRole("region", { name: "주간 시간표" });
  const card = grid.locator(".time-event").filter({ hasText: task.title });
  await card.scrollIntoViewIfNeeded();

  async function dragTo(
    day: string,
    minute: number,
    expectedStart: string,
    expectedEnd: string,
  ) {
    const source = (await card.boundingBox())!;
    const column = (await grid
      .locator(`[data-calendar-day="${day}"]`)
      .boundingBox())!;
    const rowHeight = column.height / 1440;
    await page.mouse.move(source.x + source.width / 2, source.y + 7);
    await page.mouse.down();
    await page.mouse.move(
      column.x + column.width / 2,
      column.y + minute * rowHeight + 7,
      { steps: 10 },
    );
    await expect(
      grid.locator(`[data-calendar-day="${day}"] .time-drop-preview`),
    ).toBeVisible();
    const changed = page.waitForRequest(
      (r) =>
        r.method() === "PATCH" && r.url().endsWith("/api/tasks/" + task.id),
    );
    await page.mouse.up();
    expect((await changed).postDataJSON()).toEqual({
      earliest_start: expectedStart,
      latest_end: expectedEnd,
    });
    await expect(
      grid.locator(`[data-calendar-day="${day}"] .time-event`),
    ).toContainText(task.title);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }

  await dragTo(
    "2026-11-23",
    557,
    "2026-11-23T00:15:00.000Z",
    "2026-11-23T01:15:00.000Z",
  );
  await dragTo(
    "2026-11-24",
    631,
    "2026-11-24T01:30:00.000Z",
    "2026-11-24T02:30:00.000Z",
  );
});

test("day view edge drops move to the adjacent date without changing the Seoul time", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "Uses an actual mouse");
  const dated = {
    ...task,
    earliest_start: "2026-11-23T00:07:00Z",
    latest_end: "2026-11-23T01:07:00Z",
  };
  await mockApi(page, [], { tasks: [dated] });
  await login(page);
  await page.goto("/calendar?date=2026-11-23");
  const grid = page.getByRole("region", { name: "하루 시간표" });
  const card = grid.locator(".time-event").filter({ hasText: task.title });
  const previous = grid.locator('[data-day-drop-edge="previous"]');
  const next = grid.locator('[data-day-drop-edge="next"]');
  const previousBounds = (await previous.boundingBox())!;
  const nextBounds = (await next.boundingBox())!;
  const dayBounds = (await grid.locator("[data-calendar-day]").boundingBox())!;
  expect(previousBounds.width).toBeGreaterThan(40);
  expect(nextBounds.width).toBe(previousBounds.width);
  expect(nextBounds.x).toBeCloseTo(dayBounds.x + dayBounds.width, 0);

  for (const [edge, day] of [
    ["previous", "2026-11-22"],
    ["next", "2026-11-23"],
  ] as const) {
    await card.scrollIntoViewIfNeeded();
    const block = (await card.boundingBox())!;
    const rail = edge === "previous" ? previous : next;
    const target = (await rail.boundingBox())!;
    const x = target.x + target.width / 2;
    await page.mouse.move(block.x + block.width / 2, block.y + 8);
    await page.mouse.down();
    await page.mouse.move(x, block.y + 8, { steps: 12 });
    await expect(rail).toHaveAttribute("data-active", "true");
    await expect(rail.locator(".time-day-edge-label")).toHaveText(
      edge === "previous" ? "전날로 이동" : "다음 날로 이동",
    );
    await expect(rail.locator(".time-day-edge-label")).toBeInViewport();
    const changed = page.waitForRequest(
      (request) =>
        request.method() === "PATCH" &&
        request.url().endsWith("/api/tasks/" + task.id),
    );
    await page.mouse.up();
    expect((await changed).postDataJSON()).toEqual({
      earliest_start: `${day}T00:07:00.000Z`,
      latest_end: `${day}T01:07:00.000Z`,
    });
    await expect(page.getByLabel("기준 날짜")).toHaveValue(day);
    await expect(
      grid.locator(`[data-calendar-day="${day}"] .time-event`),
    ).toContainText("09:07");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
});

test("URL deadline at 23:59 can be dragged from its visible weekly title", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "Uses an actual mouse");
  await mockApi(page, [], {
    deadlines: [
      {
        id: "url-deadline",
        title: "URL 채용 마감",
        due_at: "2026-11-23T14:59:59Z",
        source_id: "url-source",
        safe_due_at: null,
        safety_buffer_minutes: null,
        deadline_type: null,
        description: null,
        confidence: "1",
        evidence_text: "접수 마감",
        is_confirmed: true,
        created_at: task.created_at,
        updated_at: task.updated_at,
      },
    ],
  });
  await login(page);
  await page.goto("/calendar?date=2026-11-23");
  await page.getByRole("button", { name: "주간", exact: true }).click();
  const grid = page.getByRole("region", { name: "주간 시간표" });
  const card = grid.locator(".time-event").filter({ hasText: "URL 채용 마감" });
  await expect(card).toHaveCount(1);
  await expect(
    grid.locator('[data-calendar-day="2026-11-24"] .time-event'),
  ).toHaveCount(0);
  await card.scrollIntoViewIfNeeded();
  const title = card.locator("strong");
  await title.hover();
  const box = (await title.boundingBox())!;
  const column = (await grid
    .locator('[data-calendar-day="2026-11-24"]')
    .boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(column.x + column.width / 2, column.y + 23 * 56 + 7, {
    steps: 10,
  });
  await expect(grid.locator(".time-drop-preview")).toBeVisible();
  const saved = page.waitForRequest(
    (r) =>
      r.method() === "PATCH" && r.url().endsWith("/api/deadlines/url-deadline"),
  );
  await page.mouse.up();
  await saved;
});
