import { test, expect, type Page } from "@playwright/test";
import { login, mockApi } from "./fixtures";
import { aiSource } from "./analysis-fixtures";
import type { Source, Deadline } from "../types/api";

type Kind = "sources" | "deadlines";
async function seed(page: Page, kind: Kind, count = 3) {
  await mockApi(page);
  const deadline: Deadline = {
    id: "",
    title: "",
    due_at: "2026-11-03T14:59:00Z",
    source_id: null,
    safety_buffer_minutes: null,
    safe_due_at: null,
    deadline_type: null,
    description: null,
    confidence: null,
    evidence_text: null,
    is_confirmed: true,
    created_at: aiSource.created_at,
    updated_at: aiSource.updated_at,
  };
  const state = {
    items: Array.from({ length: count }, (_, index): Source | Deadline => ({
      ...(kind === "sources"
        ? {
            ...aiSource,
            source_type: "url",
            original_url: "https://example.com/notice",
            original_text: null,
          }
        : deadline),
      id: `item-${index + 1}`,
      title: `테스트 항목 ${index + 1}`,
    })),
    attempts: [] as string[],
    failOnce: new Set<string>(),
    uncertainOnce: new Set<string>(),
    waiting: null as Promise<void> | null,
  };
  await page.route(`**/test-api/api/${kind}**`, async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    const suffix = url.pathname.slice(`/test-api/api/${kind}`.length);
    if (!suffix && req.method() === "GET") {
      const offset = Number(url.searchParams.get("offset") ?? 0);
      return route.fulfill({ json: state.items.slice(offset, offset + 50) });
    }
    const id = decodeURIComponent(suffix.slice(1));
    const item = state.items.find((entry) => entry.id === id);
    if (req.method() === "DELETE") {
      state.attempts.push(id);
      if (state.waiting) await state.waiting;
      if (state.failOnce.delete(id))
        return route.fulfill({
          status: 409,
          json: { detail: "Currently processing" },
        });
      if (!item)
        return route.fulfill({ status: 404, json: { detail: "Not found" } });
      state.items = state.items.filter((entry) => entry.id !== id);
      if (state.uncertainOnce.delete(id)) return route.abort("failed");
      return route.fulfill({ status: 204 });
    }
    if (item && req.method() === "GET") return route.fulfill({ json: item });
    return route.fallback();
  });
  await login(page);
  await page.goto(`/${kind}`);
  await expect(page.getByText("테스트 항목 1", { exact: true })).toBeVisible();
  return state;
}
const row = (page: Page, number: number) =>
  page.getByRole("checkbox", {
    name: `테스트 항목 ${number} 선택`,
    exact: true,
  });
const mode = (page: Page) =>
  page.getByRole("button", { name: "삭제 모드", exact: true });
const remove = (page: Page) =>
  page.getByRole("button", { name: "삭제", exact: true });
const confirm = (page: Page) =>
  page.getByRole("button", { name: "삭제 확인", exact: true });

test("마감일 삭제 확인에 원본 정리를 안내하고 분석 중이면 한글로 안내한다", async ({
  page,
}) => {
  const state = await seed(page, "deadlines");
  await page.route("**/test-api/api/deadlines/item-1", (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    return route.fulfill({
      status: 409,
      json: { detail: "deadline_source_busy" },
    });
  });
  await mode(page).click();
  await row(page, 1).click();
  await remove(page).click();
  await expect(
    page.getByText(
      "다른 마감일이 연결되어 있지 않으면 원본 자료와 검토 기록도 함께 삭제됩니다. 연결된 할 일과 Google 일정은 유지됩니다.",
      { exact: false },
    ),
  ).toBeVisible();
  expect(state.items).toHaveLength(3);
  await confirm(page).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "분석이 끝난 뒤 다시 삭제해 주세요",
  );
  await expect(row(page, 1)).toBeChecked();
  expect(state.items).toHaveLength(3);
});

for (const kind of ["sources", "deadlines"] as const) {
  test(`${kind}: red controls, whole-item/keyboard toggle and exit preserve data`, async ({
    page,
  }) => {
    const state = await seed(page, kind);
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    const color = await mode(page).evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.color, style.backgroundColor, style.borderTopColor];
    });
    expect(color).toEqual([
      "rgb(185, 56, 49)",
      "rgb(255, 255, 255)",
      "rgb(185, 56, 49)",
    ]);
    const register = page.getByRole(kind === "sources" ? "link" : "button", {
      name: kind === "sources" ? "＋ 자료 등록" : "＋ 마감일 등록",
      exact: true,
    });
    if (page.viewportSize()!.width > 1000)
      expect((await mode(page).boundingBox())!.x).toBeLessThan(
        (await register.boundingBox())!.x,
      );
    await mode(page).click();
    await expect(remove(page)).toBeDisabled();
    await row(page, 1).getByText("테스트 항목 1", { exact: true }).click();
    await expect(row(page, 1)).toBeChecked();
    if (kind === "sources")
      await row(page, 1)
        .getByText("https://example.com/notice", { exact: true })
        .click();
    else await row(page, 1).getByText("확인 완료", { exact: true }).click();
    await expect(row(page, 1)).not.toBeChecked();
    await row(page, 1).focus();
    await page.keyboard.press("Space");
    await expect(row(page, 1)).toBeChecked();
    await remove(page).click();
    await expect(confirm(page)).toBeVisible();
    expect(state.attempts).toEqual([]);
    await row(page, 2).click();
    await expect(confirm(page)).toHaveCount(0);
    await expect(remove(page)).toBeEnabled();
    await page
      .getByRole("button", { name: "삭제 모드 해제", exact: true })
      .click();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    expect(state.items).toHaveLength(3);
    expect(state.attempts).toEqual([]);
  });

  test(`${kind}: only selected items are removed after a second red confirmation`, async ({
    page,
  }) => {
    const state = await seed(page, kind);
    await mode(page).click();
    await row(page, 1).click();
    await row(page, 3).click();
    await remove(page).click();
    expect(state.attempts).toEqual([]);
    expect(
      await confirm(page).evaluate((element) => [
        getComputedStyle(element).backgroundColor,
        getComputedStyle(element).color,
      ]),
    ).toEqual(["rgb(185, 56, 49)", "rgb(255, 255, 255)"]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: test.info().outputPath(`${kind}-delete-confirm.png`),
      fullPage: true,
    });
    await confirm(page).click();
    await expect(row(page, 1)).toHaveCount(0);
    await expect(row(page, 3)).toHaveCount(0);
    await expect(row(page, 2)).not.toBeChecked();
    expect(state.attempts).toEqual(["item-1", "item-3"]);
    expect(state.items.map((item) => item.id)).toEqual(["item-2"]);
  });

  test(`${kind}: partial failure retains only failed selections and retry excludes successes`, async ({
    page,
  }) => {
    const state = await seed(page, kind);
    state.failOnce.add("item-1");
    await mode(page).click();
    await row(page, 1).click();
    await row(page, 2).click();
    await remove(page).click();
    await confirm(page).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "1개 항목을 삭제하지 못해",
    );
    await expect(row(page, 1)).toBeChecked();
    await expect(row(page, 2)).toHaveCount(0);
    expect(state.attempts).toEqual(["item-1", "item-2"]);
    await remove(page).click();
    await confirm(page).click();
    await expect(row(page, 1)).toHaveCount(0);
    expect(state.attempts).toEqual(["item-1", "item-2", "item-1"]);
  });

  test(`${kind}: lost delete response is checked safely with the same item id`, async ({
    page,
  }) => {
    const state = await seed(page, kind);
    state.uncertainOnce.add("item-1");
    await mode(page).click();
    await row(page, 1).click();
    await remove(page).click();
    await confirm(page).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "선택을 유지",
    );
    await expect(row(page, 1)).toBeChecked();
    await remove(page).click();
    await confirm(page).click();
    await expect(row(page, 1)).toHaveCount(0);
    expect(state.attempts).toEqual(["item-1", "item-1"]);
    expect(state.items).toHaveLength(2);
  });

  test(`${kind}: changing page clears selection and confirmation`, async ({
    page,
  }) => {
    await seed(page, kind, 51);
    await mode(page).click();
    await row(page, 1).click();
    await remove(page).click();
    await page.getByRole("button", { name: "다음", exact: true }).click();
    await expect(
      page.getByText("테스트 항목 51", { exact: true }),
    ).toBeVisible();
    await expect(mode(page)).toBeVisible();
    await mode(page).click();
    await expect(row(page, 51)).not.toBeChecked();
    await expect(remove(page)).toBeDisabled();
    await expect(confirm(page)).toHaveCount(0);
  });

  test(`${kind}: pending deletion locks controls and navigation cancels subsequent deletions`, async ({
    page,
  }) => {
    const state = await seed(page, kind);
    let release!: () => void;
    state.waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    await mode(page).click();
    await row(page, 1).click();
    await row(page, 2).click();
    await remove(page).click();
    await confirm(page).click();
    await expect(page.getByRole("button", { name: "삭제 중…" })).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "삭제 모드 해제" }),
    ).toBeDisabled();
    await page.getByRole("link", { name: "대시보드", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    release();
    await expect(
      page.getByRole("heading", { name: /오늘도 차근차근/ }),
    ).toBeVisible();
    expect(state.attempts).toEqual(["item-1"]);
  });
}
