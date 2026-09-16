import { test, expect } from "@playwright/test";
import { login, mockApi } from "./fixtures";
test.beforeEach(async ({ page }) => {
  await mockApi(page);
});
test("protected routes, signup, login restore and logout", async ({ page }) => {
  await page.goto("/sources");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole("link", { name: "회원가입", exact: true }).click();
  await page.getByLabel("이메일", { exact: true }).fill("tester@example.com");
  await page.getByLabel("비밀번호", { exact: true }).fill("Test-password-123");
  await page.getByLabel("비밀번호 확인").fill("Test-password-123");
  await page.getByRole("button", { name: "계정 만들기" }).click();
  await expect(page.getByText("가입이 완료되었습니다.")).toBeVisible();
  await login(page);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "테스터님, 오늘도 차근차근." }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("dashboard.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(
    await page.evaluate(() => sessionStorage.getItem("plancatch.access_token")),
  ).toBeNull();
  await page.goto("/deadlines/deadline-1");
  await expect(page).toHaveURL(/\/login$/);
});
test("URL and text source registration and empty list", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "원본 자료", exact: true }).click();
  await expect(page.getByText("등록된 자료가 없습니다")).toBeVisible();
  await page.getByRole("link", { name: "＋ 자료 등록" }).click();
  await page.getByLabel("자료 제목 (선택)").fill("수업 공지");
  await page.getByLabel("원본 URL").fill("https://example.com/notice");
  await page.getByRole("button", { name: "자료 저장" }).click();
  await expect(page.getByRole("heading", { name: "수업 공지" })).toBeVisible();
  await page.getByRole("link", { name: "＋ 자료 등록" }).click();
  await page.getByRole("button", { name: "텍스트", exact: true }).click();
  await page.getByLabel("원본 텍스트").fill("다음 주 발표 자료 제출");
  await page.getByRole("button", { name: "자료 저장" }).click();
  await page.getByText("텍스트 내용 보기").click();
  await expect(
    page.getByText("다음 주 발표 자료 제출", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
test("deadline create, Seoul conversion, edit and delete", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "마감일", exact: true }).click();
  await expect(page.getByText("아직 마감일이 없습니다")).toBeVisible();
  await page.getByRole("button", { name: "＋ 마감일 등록" }).click();
  await page.getByLabel("마감 제목").fill("최종 발표");
  await page.getByLabel("마감 일시 (한국 시간)").fill("2026-10-01T09:30");
  const sent = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/api/deadlines"),
  );
  await page.getByRole("button", { name: "마감일 등록", exact: true }).click();
  expect((await sent).postDataJSON().due_at).toBe("2026-10-01T00:30:00.000Z");
  await expect(page).toHaveURL(/\/deadlines\/deadline-1$/);
  await expect(page.getByRole("heading", { name: "마감일 상세" })).toBeVisible();
  await expect(page.getByLabel("마감 일시 (한국 시간)")).toHaveValue(
    "2026-10-01T09:30",
  );
  await page.getByLabel("마감 제목").fill("최종 발표 수정");
  await page.getByLabel("확인한 마감일로 표시").check();
  await expect(page.getByLabel("마감 제목")).toHaveValue("최종 발표 수정");
  const update = page.waitForRequest((r) => r.method() === "PATCH");
  await page.getByRole("button", { name: "변경 사항 저장" }).click();
  expect((await update).postDataJSON().title).toBe("최종 발표 수정");
  await expect(page.getByText("변경 사항을 저장했습니다.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("마감 제목")).toHaveValue("최종 발표 수정");
  await expect(page.getByLabel("확인한 마감일로 표시")).toBeChecked();
  await page.screenshot({
    path: test.info().outputPath("deadline-detail.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "삭제", exact: true }).click();
  await page.getByRole("button", { name: "삭제 확인" }).click();
  await expect(page).toHaveURL(/\/deadlines$/);
  await expect(page.getByText("아직 마감일이 없습니다")).toBeVisible();
});
test("backend error, retry and expired session", async ({ page }) => {
  await login(page);
  await page.route("**/test-api/api/sources?**", (route) =>
    route.fulfill({ status: 500, json: { detail: "일시적인 서버 오류" } }),
  );
  await page.getByRole("link", { name: "원본 자료", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "일시적인 서버 오류" }),
  ).toBeVisible();
  await page.unroute("**/test-api/api/sources?**");
  await page.getByRole("button", { name: "다시 시도" }).click();
  await expect(page.getByText("등록된 자료가 없습니다")).toBeVisible();
  await page.route("**/test-api/api/auth/me", (route) =>
    route.fulfill({ status: 401, json: { detail: "Unauthorized" } }),
  );
  await page.reload();
  await expect(page).toHaveURL(/\/login$/);
  expect(
    await page.evaluate(() => sessionStorage.getItem("plancatch.access_token")),
  ).toBeNull();
});

test("editing a title preserves deadline seconds", async ({ page }) => {
  await login(page);
  const deadline = {
    id: "precision-check", title: "초 단위 마감", due_at: "2026-10-01T00:30:45.123Z",
    source_id: null, deadline_type: null, description: null, confidence: null,
    evidence_text: null, is_confirmed: false,
    created_at: "2026-09-16T00:00:00Z", updated_at: "2026-09-16T00:00:00Z",
  };
  await page.route("**/test-api/api/deadlines/precision-check", async (route) => {
    if (route.request().method() === "PATCH") {
      Object.assign(deadline, route.request().postDataJSON());
    }
    await route.fulfill({ json: deadline });
  });
  await page.goto("/deadlines/precision-check");
  await page.getByLabel("마감 제목").fill("제목만 변경");
  const sent = page.waitForRequest((request) => request.method() === "PATCH");
  await page.getByRole("button", { name: "변경 사항 저장" }).click();
  expect((await sent).postDataJSON().due_at).toBe("2026-10-01T00:30:45.123Z");
  await expect(page.getByText("변경 사항을 저장했습니다.")).toBeVisible();
});

test("retry clears stale error while request is pending", async ({ page }) => {
  await login(page);
  await page.route("**/test-api/api/sources?**", (route) =>
    route.fulfill({ status: 500, json: { detail: "재시도 테스트" } }),
  );
  await page.getByRole("link", { name: "원본 자료", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "재시도 테스트" })).toBeVisible();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/test-api/api/sources?**", async (route) => {
    await pending;
    await route.fulfill({ json: [] });
  });
  await page.getByRole("button", { name: "다시 시도" }).click();
  try {
    await expect(page.getByRole("alert").filter({ hasText: "재시도 테스트" })).toHaveCount(0);
    await expect(page.getByText("불러오는 중입니다…", { exact: true })).toBeVisible();
  } finally {
    release();
  }
  await expect(page.getByText("등록된 자료가 없습니다")).toBeVisible();
});
