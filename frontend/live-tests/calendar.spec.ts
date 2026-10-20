import { randomBytes } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import type { Task } from "../types/task";
import type { ScheduledEvent } from "../types/scheduled-event";

const upstream = process.env.PLANCATCH_LIVE_API_URL?.trim().replace(/\/$/, "");
test.beforeAll(() => {
  if (!upstream)
    throw new Error(
      "PLANCATCH_LIVE_API_URL is required for explicit live testing",
    );
});
async function ownRequest(page: Page, path: string, method = "GET") {
  // Return only this test account's resource data, never login credentials/tokens.
  return page.evaluate(
    async ({ path, method }) => {
      const response = await fetch(`/test-api${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${sessionStorage.getItem("plancatch.access_token")}`,
        },
      });
      return {
        status: response.status,
        data: response.status === 204 ? null : await response.json(),
      };
    },
    { path, method },
  );
}

test("live dedicated account: calendar placement persistence, editing, cancellation and cleanup", async ({
  page,
}) => {
  const marker = `[테스트] Codex 캘린더 ${randomBytes(5).toString("hex")}`;
  const email = `plancatch-calendar-${randomBytes(8).toString("hex")}@example.com`;
  const password = randomBytes(24).toString("base64url");
  let taskId: string | undefined;
  const eventIds = new Set<string>();
  await page.route("**/test-api/api/**", async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({
      url: `${upstream}${url.pathname.replace("/test-api", "")}${url.search}`,
    });
    await route.fulfill({ response });
  });
  await page.goto("/signup");
  await page.getByLabel("이름 (선택)").fill("전용 캘린더 테스트");
  await page.getByLabel("이메일", { exact: true }).fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByLabel("비밀번호 확인", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "계정 만들기 →", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "가입이 완료되었습니다.", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "로그인으로 이동", exact: true })
    .click();
  await page.getByLabel("이메일", { exact: true }).fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByRole("button", { name: "로그인 →", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  try {
    await page
      .getByRole("link", { name: "새 일정 등록하기 ↗", exact: true })
      .click();
    await page
      .getByRole("tab", { name: "수동 일정 등록", exact: true })
      .click();
    await page.getByLabel("일정명", { exact: true }).fill(marker);
    await page
      .getByLabel("시작 일시", { exact: true })
      .fill("2026-11-15T09:00");
    await page
      .getByLabel("종료 일시", { exact: true })
      .fill("2026-11-15T10:00");
    const taskCreated = page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().endsWith("/api/tasks"),
    );
    await page.getByRole("button", { name: "일정 등록", exact: true }).click();
    const response = await taskCreated;
    const task = (await response.json()) as Task;
    if (response.status() === 201) taskId = task.id;
    expect(response.status()).toBe(201);
    await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}$`));
    const placements = page.getByRole("region", {
      name: "캘린더 배치",
      exact: true,
    });
    await placements
      .getByRole("button", { name: "캘린더에 배치", exact: true })
      .click();
    const created = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        r.url().endsWith("/api/scheduled-events"),
    );
    await placements
      .locator("form")
      .getByRole("button", { name: "캘린더에 배치", exact: true })
      .click();
    const eventResponse = await created;
    const event = (await eventResponse.json()) as ScheduledEvent;
    if (eventResponse.status() === 201) eventIds.add(event.id);
    expect(eventResponse.status()).toBe(201);
    expect(event.is_user_approved).toBe(true);
    expect(event.google_event_id).toBeNull();
    await placements
      .getByRole("link", { name: "배치 날짜 보기 →", exact: true })
      .click();
    await expect(page.locator(".calendar-agenda")).toContainText(marker);
    await page.reload();
    await expect(page.locator(".calendar-agenda > li")).toHaveCount(1);
    await expect(page.locator(".calendar-agenda")).toContainText(marker);
    await page.getByRole("link", { name: "일정 상세 · 배치 관리 →" }).click();
    await placements
      .getByRole("button", { name: "배치 수정", exact: true })
      .click();
    await placements.getByLabel("배치 시작").fill("2026-11-16T14:00");
    await placements.getByLabel("배치 종료").fill("2026-11-16T15:00");
    await placements.getByRole("button", { name: "배치 변경 저장" }).click();
    await expect(
      placements.getByText("캘린더 배치를 저장했습니다.", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(placements.locator("time").first()).toHaveAttribute(
      "datetime",
      /2026-11-16T05:00:00/,
    );
    const saved = await ownRequest(page, `/api/scheduled-events/${event.id}`);
    expect(saved.status).toBe(200);
    expect(new Date(saved.data.start_at).toISOString()).toBe(
      "2026-11-16T05:00:00.000Z",
    );
    const unchanged = await ownRequest(page, `/api/tasks/${taskId}`);
    expect(unchanged.status).toBe(200);
    expect(new Date(unchanged.data.earliest_start).toISOString()).toBe(
      "2026-11-15T00:00:00.000Z",
    );
    await placements
      .getByRole("button", { name: "배치 수정", exact: true })
      .click();
    await placements.getByLabel("배치 상태").selectOption("cancelled");
    await placements.getByRole("button", { name: "배치 변경 저장" }).click();
    await expect(placements.getByText("취소", { exact: true })).toBeVisible();
    await placements
      .getByRole("link", { name: "배치 날짜 보기 →", exact: true })
      .click();
    await expect(
      page.getByText("선택한 날짜에 배치된 일정이 없습니다", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("취소한 배치 포함").check();
    await expect(page.locator(".calendar-agenda")).toContainText(marker);
    await page.getByRole("link", { name: "일정 상세 · 배치 관리 →" }).click();
    await placements
      .getByRole("button", { name: "배치 삭제", exact: true })
      .click();
    await placements
      .getByRole("button", { name: "배치 삭제 확인", exact: true })
      .click();
    await expect(
      placements.getByText("캘린더에 배치된 시간이 없습니다", { exact: true }),
    ).toBeVisible();
    expect((await ownRequest(page, `/api/tasks/${taskId}`)).status).toBe(200);
    expect(
      (await ownRequest(page, `/api/scheduled-events/${event.id}`)).status,
    ).toBe(404);
    console.info(
      "Live calendar verification: create, persistence, edit, cancel, placement delete and task preservation passed",
    );
  } finally {
    // Clean only resources owned by this newly created, clearly marked account.
    if (taskId) {
      const listed = await ownRequest(
        page,
        `/api/scheduled-events?task_id=${encodeURIComponent(taskId)}&limit=100`,
      );
      if (listed.status === 200)
        for (const event of listed.data as ScheduledEvent[])
          eventIds.add(event.id);
      for (const id of eventIds) {
        const removed = await ownRequest(
          page,
          `/api/scheduled-events/${id}`,
          "DELETE",
        );
        expect([204, 404]).toContain(removed.status);
      }
      expect(
        (await ownRequest(page, `/api/tasks/${taskId}`, "DELETE")).status,
      ).toBe(204);
      expect((await ownRequest(page, `/api/tasks/${taskId}`)).status).toBe(404);
      console.info(
        "Live calendar verification: test placements and task cleaned up; test account remains (no deletion API)",
      );
    }
  }
});
