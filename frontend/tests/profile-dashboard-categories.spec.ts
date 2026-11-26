import { test, expect } from "@playwright/test";
import { mockApi, login } from "./fixtures";
import { calendarTask } from "./calendar-fixtures";
import { deadlineDay } from "../components/deadline-dday";

test("profile name saves and updates sidebar and dashboard immediately", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  await page.getByRole("button", { name: "설정 열기" }).click();
  await page.getByLabel("프로필 이름", { exact: true }).fill("변경한 이름");
  await page.getByRole("button", { name: "이름 저장", exact: true }).click();
  await expect(page.getByText("이름을 저장했어요.")).toBeVisible();
  await expect(page.locator(".account-row strong")).toHaveText("변경한 이름");
  await page.getByRole("button", { name: "설정 닫기" }).click();
  await expect(page.getByText("변경한 이름님, 오늘도 차근차근.")).toBeVisible();
});

test("dashboard task completion can be toggled and a failed write keeps its state", async ({
  page,
}) => {
  await mockApi(page, [], { tasks: [calendarTask] });
  await login(page);
  const check = page.getByRole("checkbox", {
    name: calendarTask.title + " 완료",
    exact: true,
  });
  await check.click();
  await expect(check).toBeChecked();
  await page.route("**/test-api/api/tasks/" + calendarTask.id, (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({ status: 500, json: { detail: "저장 실패" } })
      : route.fallback(),
  );
  await check.click();
  await expect(page.getByRole("region", {name:"할 일",exact:true}).getByRole("alert")).toContainText("저장 실패");
  await expect(check).toBeChecked();
});

test("Seoul deadline day handles midnight and exact expiry", () => {
  const now = Date.parse("2026-11-26T14:59:00Z");
  expect(deadlineDay("2026-11-26T14:59:30Z", now).text).toBe("D-Day");
  expect(deadlineDay("2026-11-26T15:00:00Z", now).text).toBe("D-1");
  expect(deadlineDay("2026-11-29T15:00:00Z", now).style).toBe("");
  expect(deadlineDay("2026-11-26T14:58:00Z", now).text).toBe("마감 지남");
});

test("category chips filter server-backed schedules and forms save categories", async ({
  page,
}) => {
  await mockApi(page, [], {
    tasks: [
      { ...calendarTask, category: "study" },
      {
        ...calendarTask,
        id: "work-task",
        title: "업무 테스트",
        category: "work",
      },
    ],
  });
  await login(page);
  await page.goto("/deadlines");
  await page
    .getByRole("group", { name: "카테고리 필터" })
    .getByRole("button", { name: "학업·과제", exact: true })
    .click();
  await expect(page.locator(".schedule-rows")).toContainText(
    calendarTask.title,
  );
  await expect(page.locator(".schedule-rows")).not.toContainText("업무 테스트");
  await page.goto("/tasks/" + calendarTask.id);
  await page.getByRole("button", { name: "일정 수정", exact: true }).click();
  await page.getByLabel("카테고리", { exact: true }).selectOption("personal");
  const saved = page.waitForRequest(
    (r) =>
      r.method() === "PATCH" &&
      r.url().endsWith("/api/tasks/" + calendarTask.id),
  );
  await page
    .getByRole("button", { name: "변경 사항 저장", exact: true })
    .click();
  expect((await saved).postDataJSON().category).toBe("personal");
});


test("deadline badges use Seoul dates in the dashboard", async ({page}) => {
  await page.clock.setFixedTime(new Date("2026-11-26T00:00:00Z"));
  const seed = { id:"badge",title:"긴급 마감",due_at:"2026-11-26T09:00:00Z",source_id:null,safety_buffer_minutes:null,safe_due_at:null,description:null,deadline_type:null,confidence:null,evidence_text:null,is_confirmed:true,created_at:"2026-11-25T00:00:00Z",updated_at:"2026-11-25T00:00:00Z" };
  await mockApi(page,[],{deadlines:[seed,{...seed,id:"tomorrow",title:"내일 마감",due_at:"2026-11-27T09:00:00Z"},{...seed,id:"past",title:"지난 마감",due_at:"2026-11-25T09:00:00Z"}]});
  await login(page);
  await expect(page.locator(".dday.is-urgent").first()).toHaveText("D-Day");
  await expect(page.locator(".dday").nth(1)).toHaveText("D-1");
  await expect(page.locator(".dday.is-past")).toHaveText("마감 지남");
});
