import { test, expect, type Page } from "@playwright/test";
import { login, mockApi, user } from "./fixtures";
import type { Source, Deadline } from "../types/api";
import type { Analysis } from "../types/analysis";

async function automaticApi(
  page: Page,
  mode: "success" | "review" | "login" | "lost" = "success",
) {
  await mockApi(page);
  let source: Source | undefined,
    analysis: Analysis | undefined,
    deadline: Deadline | undefined;
  const counts = { create: 0, extract: 0, analyze: 0, register: 0 };
  await page.route("**/test-api/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/test-api", "");
    const method = request.method();
    if (path === "/api/sources" && method === "POST") {
      counts.create++;
      source = {
        ...request.postDataJSON(),
        id: "auto-source",
        original_text: null,
        extracted_text: null,
        storage_key: null,
        processing_status: "pending",
        error_message: null,
        created_at: "2026-09-30T00:00:00Z",
        updated_at: "2026-09-30T00:00:00Z",
      };
      return route.fulfill({ status: 201, json: source });
    }
    if (path === "/api/sources/auto-source/analyze") {
      counts.extract++;
      source = {
        ...source!,
        processing_status: mode === "login" ? "requires_login" : "extracted",
        error_message: mode === "login" ? "requires_login" : null,
        extracted_text:
          mode === "login"
            ? null
            : "[테스트] 2026년 10월 15일 18시까지 보고서를 제출하세요.",
      };
      return route.fulfill({
        status: 202,
        json: { ...source, processing_status: "processing" },
      });
    }
    if (path === "/api/sources/auto-source")
      return route.fulfill({ json: source });
    if (path === "/api/sources/auto-source/ai-analyses") {
      if (method === "GET")
        return route.fulfill({ json: analysis ? [analysis] : [] });
      counts.analyze++;
      expect(request.postDataJSON()).toEqual({ allow_external_ai: true });
      analysis = {
        id: "auto-analysis",
        source_id: "auto-source",
        input_text: source!.extracted_text!,
        model: "test-only",
        status: "ready",
        revision: 1,
        warnings: mode === "review" ? ["[테스트] 날짜 확인"] : [],
        approved_deadline_ids: [],
        error_message: null,
        created_at: source!.created_at,
        updated_at: source!.updated_at,
        candidates: [
          {
            id: "candidate-1",
            title: "AI가 제안한 제목",
            due_at: "2026-10-15T09:00:00Z",
            description: null,
            evidence_text: source!.extracted_text!,
            confidence: 0.9,
            selected: true,
          },
        ],
      };
      return route.fulfill({
        status: 202,
        json: { ...analysis, status: "processing" },
      });
    }
    if (path === "/api/ai-analyses/auto-analysis")
      return route.fulfill({ json: analysis });
    if (path === "/api/ai-analyses/auto-analysis/auto-register") {
      counts.register++;
      expect(request.postDataJSON()).toEqual({
        revision: 1,
        title: "[테스트] 사용자 지정 일정",
        confirm_auto_registration: true,
      });
      if (mode === "review")
        return route.fulfill({
          status: 422,
          json: { detail: "auto_registration_requires_review" },
        });
      deadline = {
        id: "deadline-1",
        source_id: "auto-source",
        title: source!.title!,
        due_at: "2026-10-15T09:00:00Z",
        deadline_type: null,
        description: null,
        confidence: 0.9,
        evidence_text: source!.extracted_text,
        is_confirmed: true,
        created_at: source!.created_at,
        updated_at: source!.updated_at,
      };
      analysis = {
        ...analysis!,
        status: "approved",
        approved_deadline_ids: ["deadline-1"],
        revision: 2,
        candidates: analysis!.candidates.map((item) => ({
          ...item,
          title: source!.title!,
        })),
      };
      if (mode === "lost") return route.abort("failed");
      return route.fulfill({ json: analysis });
    }
    if (path === "/api/deadlines/deadline-1" && deadline)
      return route.fulfill({ json: deadline });
    return route.fallback();
  });
  return counts;
}

async function fill(page: Page) {
  await login(page);
  await page.getByRole("link", { name: "새 일정 등록하기 ↗" }).click();
  await expect(
    page.getByRole("heading", { name: "자동 일정 등록" }),
  ).toBeVisible();
  await page
    .getByLabel("일정 제목", { exact: true })
    .fill("[테스트] 사용자 지정 일정");
  await page
    .getByLabel("원본 URL", { exact: true })
    .fill("https://example.com/notice");
}

const storageKey = `plancatch.auto-deadline.${user.id}`;

test("new registration starts editable even with a saved interrupted registration", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  const previous = {
    title: "[테스트] 이전 일정",
    url: "https://example.com/previous",
    sourceId: "previous-source",
    analysisId: "previous-analysis",
  };
  await page.evaluate(
    ({ key, draft }) => sessionStorage.setItem(key, JSON.stringify(draft)),
    { key: storageKey, draft: previous },
  );
  await page.getByRole("link", { name: "새 일정 등록하기 ↗" }).click();
  await expect(page.getByLabel("일정 제목", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("원본 URL", { exact: true })).toHaveValue("");
  await page
    .getByLabel("일정 제목", { exact: true })
    .fill("[테스트] 새로운 일정");
  await page
    .getByLabel("원본 URL", { exact: true })
    .fill("https://example.com/new");
  expect(
    await page.evaluate(
      (key) => JSON.parse(sessionStorage.getItem(key)!),
      storageKey,
    ),
  ).toEqual(previous);
  await page
    .getByRole("button", { name: "이전 등록 이어서", exact: true })
    .click();
  await expect(page.getByLabel("일정 제목", { exact: true })).toHaveValue(
    previous.title,
  );
  await expect(page.getByLabel("원본 URL", { exact: true })).toHaveValue(
    previous.url,
  );
  await expect(page.getByLabel("일정 제목", { exact: true })).toBeEditable();
  await expect(page.getByLabel("원본 URL", { exact: true })).toBeEditable();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await page
    .getByRole("button", { name: "다른 일정 입력", exact: true })
    .click();
  await page
    .getByLabel("일정 제목", { exact: true })
    .fill("[테스트] 다시 입력");
});

test("reopening new registration resets preserved route fields and review state", async ({
  page,
}) => {
  const counts = await automaticApi(page, "review");
  await fill(page);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "일정 등록", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "AI 결과 검토하기 →" }),
  ).toBeVisible();
  const firstUrl = page.url();
  await page.getByRole("link", { name: "← 대시보드" }).click();
  await page.getByRole("link", { name: "새 일정 등록하기 ↗" }).click();
  await expect(page).not.toHaveURL(firstUrl);
  await expect(page.getByLabel("일정 제목", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("원본 URL", { exact: true })).toHaveValue("");
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await expect(
    page.getByRole("link", { name: "AI 결과 검토하기 →" }),
  ).toHaveCount(0);
  await page
    .getByLabel("일정 제목", { exact: true })
    .fill("[테스트] 두 번째 일정");
  await page
    .getByLabel("원본 URL", { exact: true })
    .fill("https://example.com/second");
  expect(counts).toEqual({ create: 1, extract: 1, analyze: 1, register: 1 });
});

test("new registration does not retain unsubmitted inputs after dashboard navigation", async ({
  page,
}) => {
  await mockApi(page);
  await fill(page);
  await page.getByRole("checkbox").check();
  await page.getByRole("link", { name: "← 대시보드" }).click();
  await page.getByRole("link", { name: "새 일정 등록하기 ↗" }).click();
  await expect(page.getByLabel("일정 제목", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("원본 URL", { exact: true })).toHaveValue("");
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await page.getByLabel("일정 제목", { exact: true }).fill("[테스트] 새 입력");
});

for (const changed of ["title", "url"] as const) {
  test(`editing a resumed ${changed} uses a new source and analysis after renewed consent`, async ({
    page,
  }) => {
    const counts = await automaticApi(page);
    await login(page);
    const previous = {
      title:
        changed === "title"
          ? "[테스트] 이전 제목"
          : "[테스트] 사용자 지정 일정",
      url: "https://example.com/old",
      sourceId: "previous-source",
      analysisId: "previous-analysis",
    };
    await page.evaluate(
      ({ key, draft }) => sessionStorage.setItem(key, JSON.stringify(draft)),
      { key: storageKey, draft: previous },
    );
    await page
      .getByRole("link", { name: "새 일정 등록하기", exact: true })
      .click();
    await page
      .getByRole("button", { name: "이전 등록 이어서", exact: true })
      .click();
    await expect(page.getByLabel("일정 제목", { exact: true })).toBeEditable();
    await expect(page.getByLabel("원본 URL", { exact: true })).toBeEditable();
    await page.getByRole("checkbox").check();
    await page
      .getByLabel(changed === "title" ? "일정 제목" : "원본 URL", {
        exact: true,
      })
      .fill(
        changed === "title"
          ? "[테스트] 사용자 지정 일정"
          : "https://example.com/changed",
      );
    await expect(page.getByRole("checkbox")).not.toBeChecked();
    await expect(
      page.getByRole("button", { name: "일정 등록", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("link", { name: "저장된 원본 자료 확인 →" }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        (key) => JSON.parse(sessionStorage.getItem(key)!),
        storageKey,
      ),
    ).toEqual(previous);
    expect(counts.create).toBe(0);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "일정 등록", exact: true }).click();
    await expect(page).toHaveURL(/\/deadlines\/deadline-1$/);
    expect(counts).toEqual({ create: 1, extract: 1, analyze: 1, register: 1 });
  });
}

test("editing after a review result clears the old result and requires fresh consent", async ({
  page,
}) => {
  const counts = await automaticApi(page, "review");
  await fill(page);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "일정 등록", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "AI 결과 검토하기 →" }),
  ).toBeVisible();
  await page
    .getByLabel("원본 URL", { exact: true })
    .fill("https://example.com/revised");
  await expect(
    page.getByRole("link", { name: "AI 결과 검토하기 →" }),
  ).toHaveCount(0);
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "일정 등록", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText(
      "입력을 변경하여 새 등록으로 진행합니다. 이전 자료와 분석은 그대로 유지됩니다.",
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "이전 등록 이어서", exact: true })
    .click();
  await expect(page.getByLabel("원본 URL", { exact: true })).toHaveValue(
    "https://example.com/notice",
  );
  expect(counts).toEqual({ create: 1, extract: 1, analyze: 1, register: 1 });
});

test("blue sidebar registration matches menu typography and opens a fresh form from any workspace page", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  const button = page.getByRole("link", {
    name: "새 일정 등록하기",
    exact: true,
  });
  await expect(button).toBeVisible();
  const styles = await page.locator(".sidebar").evaluate((sidebar) => {
    const button = sidebar.querySelector(".sidebar-new-registration")!;
    const menu = sidebar.querySelector("nav a")!;
    const caption = sidebar.querySelector(".nav-caption")!;
    const buttonStyle = getComputedStyle(button),
      menuStyle = getComputedStyle(menu);
    const typography = (style: CSSStyleDeclaration) => [
      style.fontFamily,
      style.fontSize,
      style.fontWeight,
      style.lineHeight,
    ];
    return {
      button: typography(buttonStyle),
      menu: typography(menuStyle),
      blue: buttonStyle.backgroundColor,
      white: buttonStyle.color,
      above:
        button.getBoundingClientRect().bottom <=
        (getComputedStyle(caption).display === "none"
          ? menu
          : caption
        ).getBoundingClientRect().top,
      overflow:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1,
    };
  });
  expect(styles.button).toEqual(styles.menu);
  expect(styles.blue).toBe("rgb(48, 94, 232)");
  expect(styles.white).toBe("rgb(255, 255, 255)");
  expect(styles.above).toBe(true);
  expect(styles.overflow).toBe(false);
  for (const menu of ["원본 자료", "작업"]) {
    await page.getByRole("link", { name: menu, exact: true }).click();
    await button.click();
    await expect(
      page.getByRole("heading", { name: "자동 일정 등록", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("일정 제목", { exact: true })).toHaveValue("");
    await page
      .getByLabel("일정 제목", { exact: true })
      .fill("[테스트] 이전 화면 입력");
    const before = page.url();
    await button.click();
    await expect(page).not.toHaveURL(before);
    await expect(page.getByLabel("일정 제목", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("원본 URL", { exact: true })).toBeEditable();
  }
});

test("malformed resume storage and another user's draft cannot lock a new form", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  await page.evaluate((key) => {
    sessionStorage.setItem(
      key,
      '{"title":"bad","url":"https://example.com","sourceId":42}',
    );
    sessionStorage.setItem(
      "plancatch.auto-deadline.other-user",
      JSON.stringify({
        title: "other",
        url: "https://example.com",
        sourceId: "other-source",
      }),
    );
  }, storageKey);
  await page.goto("/deadlines/auto");
  await expect(
    page.getByRole("button", { name: "이전 등록 이어서", exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("일정 제목", { exact: true })
    .fill("[테스트] 직접 접속");
  await page
    .getByLabel("원본 URL", { exact: true })
    .fill("https://example.com/direct");
  await page.reload();
  await expect(page.getByLabel("일정 제목", { exact: true })).toHaveValue("");
});

test("new input creates its own source rather than resuming a saved source", async ({
  page,
}) => {
  const counts = await automaticApi(page);
  await login(page);
  await page.evaluate(
    (key) =>
      sessionStorage.setItem(
        key,
        JSON.stringify({
          title: "old",
          url: "https://example.com/old",
          sourceId: "old-source",
        }),
      ),
    storageKey,
  );
  await page.getByRole("link", { name: "새 일정 등록하기 ↗" }).click();
  await page
    .getByLabel("일정 제목", { exact: true })
    .fill("[테스트] 사용자 지정 일정");
  await page
    .getByLabel("원본 URL", { exact: true })
    .fill("https://example.com/new");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "일정 등록", exact: true }).click();
  await expect(page).toHaveURL(/\/deadlines\/deadline-1$/);
  expect(counts).toEqual({ create: 1, extract: 1, analyze: 1, register: 1 });
  await page.getByRole("link", { name: "대시보드", exact: true }).click();
  await page.getByRole("link", { name: "새 일정 등록하기 ↗" }).click();
  await expect(page.getByLabel("일정 제목", { exact: true })).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "이전 등록 이어서", exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("원본 URL", { exact: true })
    .fill("https://example.com/next");
});

test("dashboard automatic registration consent, pipeline, requested title and reload", async ({
  page,
}) => {
  const counts = await automaticApi(page);
  await fill(page);
  await expect(
    page.getByRole("button", { name: "일정 등록", exact: true }),
  ).toBeDisabled();
  expect(counts.create).toBe(0);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "일정 등록", exact: true }).dblclick();
  await expect(page).toHaveURL(/\/deadlines\/deadline-1$/);
  await expect(page.getByLabel("마감 제목")).toHaveValue(
    "[테스트] 사용자 지정 일정",
  );
  await expect(page.getByLabel("마감 일시 (한국 시간)")).toHaveValue(
    "2026-10-15T18:00",
  );
  await page.reload();
  await expect(page.getByLabel("마감 제목")).toHaveValue(
    "[테스트] 사용자 지정 일정",
  );
  expect(counts).toEqual({ create: 1, extract: 1, analyze: 1, register: 1 });
});

test("ambiguous result links to review without registering a deadline", async ({
  page,
}) => {
  const counts = await automaticApi(page, "review");
  await fill(page);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "일정 등록", exact: true }).click();
  await expect(page.getByText(/자동 등록하지 않았습니다/)).toBeVisible();
  await page.getByRole("link", { name: "AI 결과 검토하기 →" }).click();
  await expect(
    page.getByRole("heading", { name: "AI 마감일 검토", exact: true }),
  ).toBeVisible();
  expect(counts.register).toBe(1);
});

test("login-required URL does not start AI and preserves registration inputs", async ({
  page,
}) => {
  const counts = await automaticApi(page, "login");
  await fill(page);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "일정 등록", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "로그인이 필요한 페이지" }),
  ).toBeVisible();
  await expect(page.getByLabel("일정 제목", { exact: true })).toHaveValue(
    "[테스트] 사용자 지정 일정",
  );
  expect(counts.analyze).toBe(0);
  expect(counts.register).toBe(0);
});

test("lost success response and refresh resume do not duplicate source, AI or deadline", async ({
  page,
}) => {
  const counts = await automaticApi(page, "lost");
  await fill(page);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "일정 등록", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "서버에 연결하지 못했습니다" }),
  ).toBeVisible();
  expect(counts.register).toBe(1);
  await page.reload();
  await expect(page.getByLabel("일정 제목", { exact: true })).toHaveValue("");
  await page
    .getByRole("button", { name: "이전 등록 이어서", exact: true })
    .click();
  await expect(page.getByLabel("일정 제목", { exact: true })).toHaveValue(
    "[테스트] 사용자 지정 일정",
  );
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "이어서 등록", exact: true }).click();
  await expect(page).toHaveURL(/\/deadlines\/deadline-1$/);
  expect(counts).toEqual({ create: 1, extract: 1, analyze: 1, register: 1 });
});

test("source library still offers the unchanged manual source form", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  await page.getByRole("link", { name: "원본 자료", exact: true }).click();
  await page.getByRole("link", { name: "＋ 자료 등록" }).click();
  await expect(
    page.getByRole("heading", { name: "자료 등록", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "자료 저장", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "텍스트", exact: true }),
  ).toBeVisible();
});
