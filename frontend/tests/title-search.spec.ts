import { test, expect, type Page } from "@playwright/test";
import { login, mockApi } from "./fixtures";
import { aiSource } from "./analysis-fixtures";

async function seed(page: Page, kind: "sources" | "deadlines") {
  await mockApi(page);
  const common =
    kind === "sources"
      ? aiSource
      : {
          due_at: "2026-11-03T14:59:00Z",
          source_id: null,
          deadline_type: null,
          description: null,
          confidence: null,
          evidence_text: null,
          is_confirmed: true,
          safety_buffer_minutes: null,
          safe_due_at: null,
          created_at: aiSource.created_at,
          updated_at: aiSource.updated_at,
        };
  const state = {
    items: Array.from({ length: 52 }, (_, index) => ({
      ...common,
      id: `search-${index}`,
      title:
        index === 50
          ? "마케팅 마케팅 공채"
          : index === 51
            ? "PlanCatch [100%_] <b>공채</b>"
            : `일반 공고 ${index}`,
    })),
    requests: [] as { query: string; offset: number }[],
    hold: null as Promise<void> | null,
    deleteHold: null as Promise<void> | null,
  };
  await page.route(`**/test-api/api/${kind}**`, async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (
      url.pathname === `/test-api/api/${kind}` &&
      request.method() === "GET"
    ) {
      const query = url.searchParams.get("q") ?? "",
        offset = Number(url.searchParams.get("offset") ?? 0);
      state.requests.push({ query, offset });
      if (query === "일반" && state.hold) await state.hold;
      const items = state.items.filter((item) =>
        item.title.toLowerCase().includes(query.toLowerCase()),
      );
      return route.fulfill({ json: items.slice(offset, offset + 50) });
    }
    if (request.method() === "DELETE") {
      if (state.deleteHold) await state.deleteHold;
      state.items = state.items.filter(
        (item) => !url.pathname.endsWith("/" + item.id),
      );
      return route.fulfill({ status: 204 });
    }
    return route.fallback();
  });
  await login(page);
  await page.goto("/" + kind);
  await expect(page.getByText("일반 공고 0", { exact: true })).toBeVisible();
  return state;
}

for (const kind of ["sources", "deadlines"] as const) {
  test(`${kind}: live search covers later pages, highlights every match, resets and handles literal input`, async ({
    page,
  }) => {
    const state = await seed(page, kind),
      input = page.getByRole("searchbox");
    await input.fill("마케팅");
    await expect(page.locator("mark")).toHaveText(["마케팅", "마케팅"]);
    await expect(page.getByText("일반 공고 0", { exact: true })).toHaveCount(0);
    expect(state.requests.at(-1)).toEqual({ query: "마케팅", offset: 0 });
    expect(
      await page
        .locator("mark")
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe("rgb(255, 230, 129)");
    await input.fill("[100%_]");
    await page.getByRole("button", { name: "검색", exact: true }).click();
    await expect(page.locator("mark")).toHaveText(["[100%_]"]);
    await expect(
      page.getByText("PlanCatch [100%_] <b>공채</b>", { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator(".source-card h2 b, .row-title strong b"),
    ).toHaveCount(0);
    await input.fill("plancatch");
    await input.press("Enter");
    await expect(page.locator("mark")).toHaveText(["PlanCatch"]);
    await input.fill("없는제목");
    await expect(
      page.getByText("검색 결과가 없습니다", { exact: true }),
    ).toBeVisible();
    await input.fill("");
    await expect(page.getByText("일반 공고 0", { exact: true })).toBeVisible();
    await expect(page.locator("mark")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });

  test(`${kind}: search resets pagination, delete selection and confirmation`, async ({
    page,
  }) => {
    await seed(page, kind);
    await page.getByRole("button", { name: "다음", exact: true }).click();
    await expect(page.getByText("2 페이지", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "삭제 모드", exact: true }).click();
    await page
      .getByRole("checkbox", { name: "마케팅 마케팅 공채 선택", exact: true })
      .click();
    await page.getByRole("button", { name: "삭제", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "삭제 확인", exact: true }),
    ).toBeVisible();
    await page.getByRole("searchbox").fill("마케팅");
    await expect(page.getByText("1 페이지", { exact: true })).toBeVisible();
    await expect(page.locator("mark")).toHaveCount(2);
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "삭제 확인", exact: true }),
    ).toHaveCount(0);
  });

  test(`${kind}: Korean composition waits, and rapid typing uses one final query`, async ({
    page,
  }) => {
    const state = await seed(page, kind),
      input = page.getByRole("searchbox");
    state.requests.length = 0;
    await input.dispatchEvent("compositionstart");
    await input.fill("마");
    await page.waitForTimeout(450);
    expect(state.requests).toEqual([]);
    await input.fill("마케팅");
    await input.dispatchEvent("compositionend");
    await expect(page.locator("mark")).toHaveCount(2);
    expect(state.requests).toEqual([{ query: "마케팅", offset: 0 }]);
    state.requests.length = 0;
    await input.fill("P");
    await input.fill("Plan");
    await input.fill("PlanCatch");
    await expect(page.locator("mark")).toHaveText(["PlanCatch"]);
    expect(state.requests).toEqual([{ query: "PlanCatch", offset: 0 }]);
  });

  test(`${kind}: late results never replace the newer title matches`, async ({
    page,
  }) => {
    const state = await seed(page, kind),
      input = page.getByRole("searchbox");
    let release!: () => void;
    state.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    await input.fill("일반");
    await expect.poll(() => state.requests.at(-1)?.query).toBe("일반");
    await input.fill("마케팅");
    await expect(page.locator("mark")).toHaveText(["마케팅", "마케팅"]);
    release();
    await page.waitForTimeout(150);
    await expect(page.locator("mark")).toHaveText(["마케팅", "마케팅"]);
    await expect(page.getByText("일반 공고 0", { exact: true })).toHaveCount(0);
  });

  test(`${kind}: search is locked while a confirmed deletion is running`, async ({
    page,
  }) => {
    const state = await seed(page, kind);
    let release!: () => void;
    state.deleteHold = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.getByRole("button", { name: "삭제 모드", exact: true }).click();
    await page
      .getByRole("checkbox", { name: "일반 공고 0 선택", exact: true })
      .click();
    await page.getByRole("button", { name: "삭제", exact: true }).click();
    await page.getByRole("button", { name: "삭제 확인", exact: true }).click();
    await expect(page.getByRole("searchbox")).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "검색", exact: true }),
    ).toBeDisabled();
    release();
    await expect(page.getByRole("searchbox")).toBeEnabled();
    await expect(
      page.getByRole("checkbox", { name: "일반 공고 0 선택", exact: true }),
    ).toHaveCount(0);
  });
}
