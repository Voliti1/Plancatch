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
