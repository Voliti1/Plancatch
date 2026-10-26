import { test, expect, type Page } from "@playwright/test";
import { login, mockApi } from "./fixtures";
import { calendarApi, calendarEvent, calendarTask } from "./calendar-fixtures";
import { withoutLocalDuplicates } from "../features/google-calendar/events";
import type { Deadline } from "../types/api";

const deadline: Deadline = {
  id: "export-deadline",
  title: "[테스트] 지원 마감",
  due_at: "2026-11-01T14:59:00Z",
  safety_buffer_minutes: null,
  safe_due_at: null,
  source_id: null,
  deadline_type: null,
  description: null,
  confidence: null,
  evidence_text: null,
  is_confirmed: true,
  created_at: "2026-10-20T00:00:00Z",
  updated_at: "2026-10-20T00:00:00Z",
};
const preview = {
  title: deadline.title,
  start_at: deadline.due_at,
  end_at: "2026-11-01T15:00:00Z",
  status: "new",
  changed: false,
  preview_token: "test-preview-only",
  note: "마감 시각부터 1분 길이의 표시로 등록합니다. 제목·시간만 보냅니다.",
};
const region = (page: Page) =>
  page.getByRole("region", { name: "Google 일정 전송" });

test("preview is explicit, confirmation is single and desktop/mobile layout fits", async ({
  page,
}) => {
  await mockApi(page, [], { deadlines: [deadline] });
  const calls: string[] = [];
  await page.route("**/google-calendar/exports/*", async (route) => {
    const req = route.request();
    expect(req.method()).toBe("POST");
    const action = new URL(req.url()).pathname.split("/").pop()!;
    calls.push(action);
    expect(req.postDataJSON()).toMatchObject({
      kind: "deadline",
      item_id: deadline.id,
    });
    if (action === "preview") return route.fulfill({ json: preview });
    expect(req.postDataJSON()).toMatchObject({
      confirm: true,
      preview_token: preview.preview_token,
    });
    await route.fulfill({
      json: { status: "sent", google_event_id: "fake", already_sent: false },
    });
  });
  await login(page);
  await page.goto("/deadlines/" + deadline.id);
  const panel = region(page);
  await expect(panel.getByRole("button")).toHaveCount(1);
  expect(calls).toEqual([]);
  await panel
    .getByRole("button", { name: "Google 전송 미리보기", exact: true })
    .click();
  await expect(
    panel.getByRole("heading", { name: deadline.title }),
  ).toBeVisible();
  await expect(panel).toContainText("오후 11:59");
  expect(calls).toEqual(["preview"]);
  await panel
    .getByRole("button", { name: "확인 후 Google에 등록", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText("Google 등록 완료");
  expect(calls).toEqual(["preview", "confirm"]);
  await expect(
    panel.getByRole("button", { name: "확인 후 Google에 등록" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: test.info().outputPath("google-export.png"),
    fullPage: true,
  });
});

test("lost response can inspect and retry the same intent without auto submission", async ({
  page,
}) => {
  await mockApi(page, [], { deadlines: [deadline] });
  let previews = 0,
    confirms = 0;
  await page.route("**/google-calendar/exports/*", async (route) => {
    if (route.request().url().endsWith("/preview")) {
      previews++;
      return route.fulfill({
        json: { ...preview, status: previews === 1 ? "new" : "pending" },
      });
    }
    confirms++;
    return route.fulfill(
      confirms === 1
        ? { status: 502, json: { detail: "전송 응답 유실" } }
        : {
            json: {
              status: "sent",
              google_event_id: "same-id",
              already_sent: false,
            },
          },
    );
  });
  await login(page);
  await page.goto("/deadlines/" + deadline.id);
  const panel = region(page);
  await panel
    .getByRole("button", { name: "Google 전송 미리보기", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "확인 후 Google에 등록", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText("전송이 완료됐을 수");
  await panel.getByRole("button", { name: "전송 미리보기 다시 확인" }).click();
  expect(confirms).toBe(1);
  await panel.getByRole("button", { name: "같은 전송 확인·재시도" }).click();
  await expect(panel.getByRole("status")).toContainText("Google 등록 완료");
  expect(confirms).toBe(2);
});

for (const status of ["blocked", "conflict", "sent"]) {
  test(`${status} preview never offers a new Google write`, async ({
    page,
  }) => {
    await mockApi(page, [], { deadlines: [deadline] });
    await page.route("**/google-calendar/exports/preview", (route) =>
      route.fulfill({
        json: { ...preview, status, preview_token: null, changed: true },
      }),
    );
    await login(page);
    await page.goto("/deadlines/" + deadline.id);
    const panel = region(page);
    await panel
      .getByRole("button", { name: "Google 전송 미리보기", exact: true })
      .click();
    await expect(panel.getByRole("status")).toBeVisible();
    await expect(panel.getByRole("button")).toHaveCount(1);
  });
}

test("fixed tasks and confirmed placements use distinct source kinds", async ({
  page,
}) => {
  await calendarApi(page, [calendarEvent]);
  const kinds: string[] = [];
  await page.route("**/google-calendar/exports/preview", (route) => {
    kinds.push(route.request().postDataJSON().kind);
    return route.fulfill({ json: { ...preview, title: calendarTask.title } });
  });
  await login(page);
  await page.goto("/tasks/" + calendarTask.id);
  const panels = region(page);
  await expect(panels).toHaveCount(2);
  for (const panel of await panels.all())
    await panel
      .getByRole("button", { name: "Google 전송 미리보기", exact: true })
      .click();
  expect(kinds.sort()).toEqual(["event", "task"]);
});

test("only an exact owned exported copy is hidden from combined calendar", () => {
  const entry = {
    id: deadline.id,
    kind: "deadline" as const,
    title: deadline.title,
    start_at: deadline.due_at,
    end_at: null,
    is_confirmed: true,
    is_completed: false,
  };
  const event = {
    id: "google-id",
    title: deadline.title,
    start_at: deadline.due_at,
    end_at: preview.end_at,
    start_date: null,
    end_date: null,
    local_kind: "deadline" as const,
    local_item_id: deadline.id,
  };
  expect(withoutLocalDuplicates([event], [], [entry])).toEqual([]);
  expect(
    withoutLocalDuplicates(
      [{ ...event, title: "Google에서 수정" }],
      [],
      [entry],
    ),
  ).toHaveLength(1);
  expect(
    withoutLocalDuplicates([{ ...event, local_item_id: "other" }], [], [entry]),
  ).toHaveLength(1);
});
