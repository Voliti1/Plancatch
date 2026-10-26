import { test, expect } from "@playwright/test";
import { login, mockApi } from "./fixtures";
import { aiSource } from "./analysis-fixtures";

const linked = { ...aiSource, id: "linked", title: "마감일 연결 자료" };
const free = { ...aiSource, id: "free", title: "삭제 가능한 자료" };
test.beforeEach(async ({ page }) => {
  await mockApi(page, [linked, free]);
  await page.route("**/test-api/api/sources/linked", (route) =>
    route.request().method() === "DELETE"
      ? route.fulfill({ status: 409, json: { detail: "source_has_deadlines" } })
      : route.fallback(),
  );
});

test("linked source rejection in bulk keeps it selected while deleting only an unlinked source", async ({
  page,
}) => {
  await login(page);
  await page.goto("/sources");
  await page.getByRole("button", { name: "삭제 모드", exact: true }).click();
  const blocked = page.getByRole("checkbox", {
    name: linked.title + " 선택",
    exact: true,
  });
  const deletable = page.getByRole("checkbox", {
    name: free.title + " 선택",
    exact: true,
  });
  await blocked.click();
  await deletable.click();
  await page.getByRole("button", { name: "삭제", exact: true }).click();
  await page.getByRole("button", { name: "삭제 확인", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "마감일이 등록된 원본 자료는 삭제할 수 없습니다",
  );
  await expect(blocked).toBeChecked();
  await expect(deletable).toHaveCount(0);
  await expect(page.locator(".list-delete-count")).toHaveText("1개 선택");
});

test("detail source deletion explains the linked deadline and preserves its page", async ({
  page,
}) => {
  await login(page);
  await page.goto("/sources/linked");
  await page.getByRole("button", { name: "자료 삭제", exact: true }).click();
  await page.getByRole("button", { name: "삭제 확인", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "연결된 마감일을 먼저 삭제",
  );
  await expect(page).toHaveURL(/\/sources\/linked$/);
  await expect(
    page.getByRole("heading", { name: linked.title, exact: true }),
  ).toBeVisible();
});
