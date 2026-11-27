import { expect, type Page } from "@playwright/test";

export async function openMore(page: Page) {
  const more = page.getByRole("button", { name: "더보기", exact: true });
  if (
    (await more.isVisible()) &&
    (await more.getAttribute("aria-expanded")) !== "true"
  )
    await more.click();
}

export async function workspaceLink(page: Page, name: string) {
  const link = page.getByRole("link", { name, exact: true });
  if (!(await link.isVisible())) await openMore(page);
  return link;
}

export async function logoutButton(page: Page) {
  await openMore(page);
  return page.getByRole("button", { name: "로그아웃 ↗", exact: true });
}

export async function expectRegistrationCurrent(page: Page) {
  const menu = page.getByRole("navigation", { name: "주 메뉴", exact: true });
  if (await page.locator(".mobile-tabbar").isVisible()) {
    await expect(
      menu.getByRole("link", { name: "+ 새 일정 등록하기", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(menu.locator("[aria-current]")).toHaveCount(1);
  } else await expect(menu.locator("[aria-current]")).toHaveCount(0);
}
