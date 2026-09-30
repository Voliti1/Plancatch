// Test-only API responses. Production features never import these fixtures.
import { expect, type Page } from "@playwright/test";
import type { Deadline, Source } from "../types/api";
import type { Task } from "../types/task";
export const user = {
  id: "test-user",
  email: "tester@example.com",
  display_name: "테스터",
  is_active: true,
  created_at: "2026-09-16T00:00:00Z",
};
export async function mockApi(
  page: Page,
  initialSources: Source[] = [],
  initial: { deadlines?: Deadline[]; tasks?: Task[] } = {},
) {
  const sources: Source[] = initialSources.map((source) => ({ ...source }));
  let deadlines: Deadline[] = (initial.deadlines ?? []).map((item) => ({
    ...item,
  }));
  const tasks: Task[] = (initial.tasks ?? []).map((item) => ({ ...item }));
  let nextTaskId = 1;
  await page.route("**/test-api/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/test-api", "");
    const method = request.method();
    if (path === "/api/auth/signup") {
      const body = request.postDataJSON();
      expect(body.password.length).toBeGreaterThanOrEqual(8);
      return route.fulfill({ status: 201, json: user });
    }
    if (path === "/api/auth/login")
      return route.fulfill({
        json: {
          access_token: "test-only-placeholder",
          token_type: "bearer",
          expires_in: 3600,
        },
      });
    expect(request.headers().authorization).toBe(
      "Bearer test-only-placeholder",
    );
    if (path === "/api/auth/me") return route.fulfill({ json: user });
    if (path === "/api/sources") {
      if (method === "POST") {
        const source = {
          id: `source-${sources.length + 1}`,
          original_url: null,
          original_text: null,
          title: null,
          extracted_text: null,
          storage_key: null,
          processing_status: "pending",
          error_message: null,
          created_at: "2026-09-16T00:00:00Z",
          updated_at: "2026-09-16T00:00:00Z",
          ...request.postDataJSON(),
        };
        sources.push(source);
        return route.fulfill({ status: 201, json: source });
      }
      return route.fulfill({ json: sources });
    }
    if (path.startsWith("/api/sources/")) {
      if (path.endsWith("/ai-analyses") && method === "GET")
        return route.fulfill({ json: [] });
      const id = decodeURIComponent(path.slice("/api/sources/".length));
      const index = sources.findIndex((source) => source.id === id);
      if (index === -1)
        return route.fulfill({
          status: 404,
          json: { detail: "Source not found" },
        });
      if (method === "DELETE") {
        sources.splice(index, 1);
        return route.fulfill({ status: 204 });
      }
      if (method === "PATCH") {
        sources[index] = {
          ...sources[index],
          ...request.postDataJSON(),
          updated_at: "2026-09-30T01:00:00Z",
        };
      }
      return route.fulfill({ json: sources[index] });
    }
    if (path === "/api/deadlines") {
      if (method === "POST") {
        const deadline = {
          id: "deadline-1",
          confidence: null,
          evidence_text: null,
          created_at: "2026-09-16T00:00:00Z",
          updated_at: "2026-09-16T00:00:00Z",
          ...request.postDataJSON(),
        };
        deadlines.push(deadline);
        return route.fulfill({ status: 201, json: deadline });
      }
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 50);
      return route.fulfill({ json: deadlines.slice(offset, offset + limit) });
    }
    if (path === "/api/deadlines/deadline-1") {
      if (method === "DELETE") {
        deadlines = [];
        return route.fulfill({ status: 204 });
      }
      if (method === "PATCH")
        deadlines[0] = { ...deadlines[0], ...request.postDataJSON() };
      return route.fulfill({ json: deadlines[0] });
    }
    if (path.startsWith("/api/deadlines/")) {
      const deadline = deadlines.find(
        (item) => item.id === path.slice("/api/deadlines/".length),
      );
      return deadline
        ? route.fulfill({ json: deadline })
        : route.fulfill({
            status: 404,
            json: { detail: "Deadline not found" },
          });
    }
    if (path === "/api/tasks") {
      if (method === "POST") {
        const body = request.postDataJSON();
        const allowed = [
          "deadline_id",
          "title",
          "description",
          "estimated_minutes",
          "priority",
          "schedule_type",
          "earliest_start",
          "latest_end",
          "is_completed",
        ];
        expect(
          Object.keys(body).every((key) => allowed.includes(key)),
        ).toBeTruthy();
        const task = {
          id: `task-${nextTaskId++}`,
          completed_at: body.is_completed ? "2026-09-30T01:00:00Z" : null,
          created_at: "2026-09-30T00:00:00Z",
          updated_at: "2026-09-30T00:00:00Z",
          ...body,
        };
        tasks.unshift(task);
        return route.fulfill({ status: 201, json: task });
      }
      const deadline = url.searchParams.get("deadline_id");
      const completed = url.searchParams.get("is_completed");
      const scheduleType = url.searchParams.get("schedule_type");
      const filtered = tasks.filter(
        (task) =>
          (!deadline || task.deadline_id === deadline) &&
          (completed === null ||
            task.is_completed === (completed === "true")) &&
          (!scheduleType || task.schedule_type === scheduleType),
      );
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 50);
      return route.fulfill({ json: filtered.slice(offset, offset + limit) });
    }
    if (path.startsWith("/api/tasks/")) {
      const id = path.slice("/api/tasks/".length);
      const index = tasks.findIndex((task) => task.id === id);
      if (index === -1)
        return route.fulfill({
          status: 404,
          json: { detail: "Task not found" },
        });
      if (method === "DELETE") {
        tasks.splice(index, 1);
        return route.fulfill({ status: 204 });
      }
      if (method === "PATCH") {
        const body = request.postDataJSON();
        const task = tasks[index];
        const completed = body.is_completed ?? task.is_completed;
        tasks[index] = {
          ...task,
          ...body,
          updated_at: "2026-09-30T01:00:00Z",
          completed_at: completed
            ? (task.completed_at ?? "2026-09-30T01:00:00Z")
            : null,
        };
      }
      return route.fulfill({ json: tasks[index] });
    }
    return route.fulfill({ status: 404, json: { detail: "Not found" } });
  });
}
export async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("이메일", { exact: true }).fill(user.email);
  await page.getByLabel("비밀번호", { exact: true }).fill("Test-password-123");
  await page.getByRole("button", { name: "로그인 →" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole("heading", { name: "테스터님, 오늘도 차근차근." }),
  ).toBeVisible();
}
