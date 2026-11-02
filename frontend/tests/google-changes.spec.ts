import { test, expect, type Page } from "@playwright/test";
import { login, mockApi } from "./fixtures";
import type { Deadline } from "../types/api";

const item: Deadline = {
  id: "change-deadline",
  title: "수정한 마감일",
  due_at: "2026-11-12T09:30:00Z",
  safety_buffer_minutes: null,
  safe_due_at: null,
  source_id: null,
  deadline_type: null,
  description: null,
  confidence: null,
  evidence_text: null,
  is_confirmed: true,
  created_at: "2026-11-02T00:00:00Z",
  updated_at: "2026-11-02T01:00:00Z",
};
const before = {
  title: "이전 마감일",
  start_at: "2026-11-10T14:59:00Z",
  end_at: "2026-11-10T15:00:00Z",
};
const after = {
  title: item.title,
  start_at: item.due_at,
  end_at: "2026-11-12T09:31:00Z",
};
const initial = {
  ...before,
  status: "sent",
  changed: true,
  preview_token: null,
  note: "마지막으로 보낸 내용입니다.",
};
const panel = (page: Page) =>
  page.getByRole("region", { name: "Google 일정 전송", exact: true });

async function setup(
  page: Page,
  options: { error?: boolean; pending?: boolean; deleted?: boolean } = {},
) {
  await mockApi(page, [], { deadlines: [item] });
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  await page.route("**/google-calendar/exports/*", async (route) => {
    const method = route.request().url().split("/").pop()!;
    const body = route.request().postDataJSON();
    calls.push({ method, body });
    if (method === "preview")
      return route.fulfill({
        json: {
          ...initial,
          status: options.deleted
            ? "deleted"
            : options.pending
              ? "changing"
              : "sent",
          pending_action: options.pending ? "update" : null,
        },
      });
    if (method === "change-preview")
      return route.fulfill(
        options.error
          ? {
              status: 409,
              json: {
                detail: "Google에서 일정이 변경되어 덮어쓰지 않았습니다.",
              },
            }
          : {
              json: {
                action: body.action,
                before,
                after: body.action === "update" ? after : null,
                state: options.pending ? "pending" : "ready",
                preview_token: "same-change-only",
                note: "확인 후에만 Google에 반영합니다. 플랜캐치 자료는 유지됩니다.",
              },
            },
      );
    expect(method).toBe("change-confirm");
    expect(body).toMatchObject({
      preview_token: "same-change-only",
      confirm: true,
    });
    await route.fulfill({
      json: { action: body.action, state: "applied", already_applied: false },
    });
  });
  await login(page);
  await page.goto(`/deadlines/${item.id}`);
  await panel(page)
    .getByRole("button", { name: "Google 전송 미리보기", exact: true })
    .click();
  return calls;
}

test("Google changes show before/after and require a separate explicit confirmation", async ({
  page,
}) => {
  const calls = await setup(page);
  await panel(page)
    .getByRole("button", { name: "Google 수정 미리보기", exact: true })
    .click();
  const proposal = panel(page).getByRole("group", {
    name: "Google 변경 내용 확인",
    exact: true,
  });
  await expect(proposal).toContainText(before.title);
  await expect(proposal).toContainText(after.title);
  expect(calls.map((c) => c.method)).toEqual(["preview", "change-preview"]);
  await proposal
    .getByRole("button", { name: "확인 후 Google에 수정 반영", exact: true })
    .click();
  await expect(panel(page).getByRole("status")).toContainText(
    "수정 내용을 반영",
  );
  expect(calls.at(-1)!.body).toMatchObject({
    action: "update",
    kind: "deadline",
    item_id: item.id,
  });
  expect(calls.filter((c) => c.method === "change-confirm")).toHaveLength(1);
});

test("Google deletion is cancellable, distinct and does not delete the local deadline", async ({
  page,
}) => {
  const calls = await setup(page);
  let localDeletes = 0;
  page.on("request", (request) => {
    if (request.method() === "DELETE") localDeletes++;
  });
  await panel(page)
    .getByRole("button", { name: "Google 삭제 미리보기", exact: true })
    .click();
  const proposal = panel(page).getByRole("group", {
    name: "Google 변경 내용 확인",
    exact: true,
  });
  const confirm = proposal.getByRole("button", {
    name: "Google 일정 삭제 확인",
    exact: true,
  });
  await expect(confirm).toHaveClass(/google-delete-confirm/);
  await proposal.getByRole("button", { name: "닫기", exact: true }).click();
  expect(calls.filter((c) => c.method === "change-confirm")).toHaveLength(0);
  await panel(page)
    .getByRole("button", { name: "Google 삭제 미리보기", exact: true })
    .click();
  await confirm.click();
  await expect(panel(page).getByRole("status")).toContainText(
    "플랜캐치 자료는 유지",
  );
  expect(calls.at(-1)!.body.action).toBe("delete");
  expect(localDeletes).toBe(0);
  await expect(page).toHaveURL(`/deadlines/${item.id}`);
});

test("conflicts block confirmation", async ({ page }) => {
  await setup(page, { error: true });
  await panel(page)
    .getByRole("button", { name: "Google 수정 미리보기", exact: true })
    .click();
  await expect(panel(page).getByRole("alert")).toContainText(
    "덮어쓰지 않았습니다",
  );
  await expect(
    panel(page).getByRole("button", {
      name: "확인 후 Google에 수정 반영",
      exact: true,
    }),
  ).toHaveCount(0);
});

test("pending changes only retry the same action", async ({ page }) => {
  const calls = await setup(page, { pending: true });
  await expect(
    panel(page).getByRole("button", {
      name: "Google 삭제 미리보기",
      exact: true,
    }),
  ).toHaveCount(0);
  await panel(page)
    .getByRole("button", { name: "Google 수정 미리보기", exact: true })
    .click();
  await panel(page)
    .getByRole("button", { name: "같은 변경 확인·재시도", exact: true })
    .click();
  expect(calls.at(-1)!.body.action).toBe("update");
});

test("deleted exports cannot create a new Google copy", async ({ page }) => {
  const calls = await setup(page, { deleted: true });
  await expect(panel(page)).toContainText("Google 삭제 완료");
  await expect(
    panel(page).getByRole("button", {
      name: /확인 후|Google 수정|Google 삭제/,
    }),
  ).toHaveCount(0);
  expect(calls.map((c) => c.method)).toEqual(["preview"]);
});

test("changing requests disable double submission and late results stay on a new registration", async ({
  page,
}) => {
  await setup(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let writes = 0;
  await page.route(
    "**/google-calendar/exports/change-confirm",
    async (route) => {
      writes++;
      await pending;
      await route
        .fulfill({
          json: { action: "update", state: "applied", already_applied: false },
        })
        .catch(() => {});
    },
  );
  await panel(page)
    .getByRole("button", { name: "Google 수정 미리보기", exact: true })
    .click();
  await panel(page)
    .getByRole("button", { name: "확인 후 Google에 수정 반영", exact: true })
    .click();
  await expect(
    panel(page).getByRole("button", { name: "결과 확인 중…", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("link", { name: "새 일정 등록하기", exact: true })
    .click();
  release();
  expect(writes).toBe(1);
  await expect(
    page.getByRole("heading", { name: "새 일정 등록", exact: true }),
  ).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
});

test("connected account lists exported copies on demand and can manage a legacy orphan", async ({
  page,
}) => {
  await mockApi(page);
  await page.route("**/google-calendar/status", (route) =>
    route.fulfill({
      json: {
        configured: true,
        connected: true,
        reconnect_required: false,
        pending: false,
        connected_at: "2026-11-02T00:00:00Z",
        refresh_expires_at: null,
      },
    }),
  );
  let reads = 0;
  await page.route(/\/google-calendar\/exports\?/, (route) => {
    reads++;
    return route.fulfill({
      json: {
        entries: [
          {
            kind: "deadline",
            item_id: item.id,
            title: "예전 Google 일정",
            status: "sent",
          },
        ],
        has_more: false,
      },
    });
  });
  await page.route("**/google-calendar/exports/preview", (route) =>
    route.fulfill({ json: { ...initial, local_available: false } }),
  );
  await page.route("**/google-calendar/exports/change-preview", (route) =>
    route.fulfill({
      json: {
        action: "delete",
        before,
        after: null,
        state: "ready",
        preview_token: "orphan-only",
        note: "플랜캐치 자료는 유지됩니다.",
      },
    }),
  );
  await login(page);
  await page.goto("/settings/google-calendar");
  expect(reads).toBe(0);
  await page
    .getByRole("button", { name: "보낸 일정 관리", exact: true })
    .click();
  await page
    .getByRole("button", { name: "예전 Google 일정 · 전송 완료", exact: true })
    .click();
  await panel(page)
    .getByRole("button", { name: "Google 전송 미리보기", exact: true })
    .click();
  await expect(
    panel(page).getByRole("button", {
      name: "Google 수정 미리보기",
      exact: true,
    }),
  ).toHaveCount(0);
  await panel(page)
    .getByRole("button", { name: "Google 삭제 미리보기", exact: true })
    .click();
  await expect(
    panel(page).getByRole("button", {
      name: "Google 일정 삭제 확인",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
