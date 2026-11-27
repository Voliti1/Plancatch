import { expect, test } from "@playwright/test";
import { login, mockApi } from "./fixtures";

for (const [path, title] of [
  ["/login", "다시 만나 반가워요"],
  ["/signup", "회원가입"],
]) {
  test(`${path} 화면은 폼 제목만 h1으로 제공한다`, async ({ page }) => {
    await mockApi(page);
    await page.goto(path);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(
      page.getByRole("heading", { name: title, level: 1, exact: true }),
    ).toBeVisible();
    await expect(page.locator(".auth-story-title")).toHaveJSProperty(
      "tagName",
      "H2",
    );
  });
}

test("모바일 탭바·더보기는 입력 보호, 현재 위치, 다크 모드와 본문 여유 공간을 유지한다", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  await page.setViewportSize({ width: 760, height: 900 });
  const bar = page.getByRole("navigation", { name: "주 메뉴", exact: true });
  await expect(bar).toHaveClass("mobile-tabbar");
  await expect(bar.getByRole("link")).toHaveCount(5);
  await expect(page.locator(".sidebar > nav")).not.toBeVisible();
  await expect(page.locator(".sidebar-new-registration")).not.toBeVisible();
  expect(
    (await page.locator(".sidebar").boundingBox())!.height,
  ).toBeLessThanOrEqual(80);
  await expect(bar).toHaveCSS("position", "fixed");
  expect(
    await page
      .locator(".main-wrap")
      .evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom)),
  ).toBeGreaterThanOrEqual(72);
  await bar.getByRole("link", { name: "캘린더", exact: true }).click();
  await expect(page).toHaveURL(/\/calendar$/);
  await expect(
    bar.getByRole("link", { name: "캘린더", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await bar.getByRole("link", { name: "자료함", exact: true }).click();
  await expect(page).toHaveURL(/\/sources$/);
  await bar
    .getByRole("link", { name: "+ 새 일정 등록하기", exact: true })
    .click();
  await expect(page).toHaveURL(/\/sources\/new\?new=.+/);
  await expect(
    bar.getByRole("link", { name: "+ 새 일정 등록하기", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    bar.getByRole("link", { name: "자료함", exact: true }),
  ).not.toHaveAttribute("aria-current");
  await page
    .getByLabel("일정 제목 (선택)", { exact: true })
    .fill("[테스트] 남길 입력");
  page.once("dialog", (dialog) => dialog.dismiss());
  await bar.getByRole("link", { name: "캘린더", exact: true }).click();
  await expect(
    page.getByLabel("일정 제목 (선택)", { exact: true }),
  ).toHaveValue("[테스트] 남길 입력");
  page.once("dialog", (dialog) => dialog.accept());
  await bar.getByRole("link", { name: "캘린더", exact: true }).click();
  await expect(page).toHaveURL(/\/calendar$/);
  const more = page.getByRole("button", { name: "더보기", exact: true });
  await more.press("Enter");
  const extra = page.getByRole("group", { name: "추가 메뉴", exact: true });
  await expect(extra).toBeVisible();
  // The compact header must not clip the menu below its own height.
  expect(
    await extra.evaluate((el) => {
      const { left, top, width, height } = el.getBoundingClientRect();
      return [top + 24, top + height - 24].every((y) =>
        el.contains(document.elementFromPoint(left + width / 2, y)),
      );
    }),
  ).toBe(true);
  await page.keyboard.press("Tab");
  await expect(
    extra.getByRole("link", { name: "자동 시간 추천", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(extra).not.toBeVisible();
  await expect(more).toBeFocused();
  await more.click();
  await extra
    .getByRole("link", { name: "자동 시간 추천", exact: true })
    .click();
  await expect(page).toHaveURL(/\/planning$/);
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await more.click();
  await extra.getByRole("link", { name: "구글 캘린더", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/connections#google$/);
  await more.click();
  await expect(
    extra.getByRole("link", { name: "구글 캘린더", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Escape");
  await page.goto("/analyses/missing");
  await expect(
    bar.getByRole("link", { name: "자료함", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.goto("/tasks/missing");
  await expect(
    bar.getByRole("link", { name: "마감일·할 일", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.goto("/sources/new");
  await page.setViewportSize({ width: 320, height: 800 });
  await page
    .getByRole("button", { name: "다크 모드로 전환", exact: true })
    .click();
  await expect(bar).toHaveCSS("background-color", "rgb(28, 38, 54)");
  await page.locator("footer").scrollIntoViewIfNeeded();
  const footerBox = (await page.locator("footer").boundingBox())!;
  const tabBox = (await bar.boundingBox())!;
  expect(footerBox.y + footerBox.height).toBeLessThanOrEqual(tabBox.y);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("mobile-tabs-dark.png"),
    fullPage: false,
  });
  await page
    .getByRole("button", { name: "라이트 모드로 전환", exact: true })
    .click();
  await page.goto("/dashboard");
  await page.screenshot({
    path: test.info().outputPath("mobile-tabs-dashboard.png"),
    fullPage: false,
  });
  await page.setViewportSize({ width: 761, height: 900 });
  await expect(page.locator(".mobile-tabbar")).not.toBeVisible();
  await expect(page.locator(".sidebar > nav")).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "주 메뉴", exact: true })
      .getByRole("link"),
  ).toHaveCount(6);
});
