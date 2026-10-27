import { test, expect } from "@playwright/test";
import { login, mockApi, user } from "./fixtures";

test("account row replaces coming box; theme persists through reload and calendar navigation", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  await page.goto("/sources/new");
  await expect(page.locator(".coming")).toHaveCount(0);
  const row = page.locator(".account-row");
  const name = await row.locator("strong").boundingBox();
  const theme = await row
    .getByRole("button", { name: "다크 모드로 전환" })
    .boundingBox();
  const settings = await row
    .getByRole("button", { name: "설정 열기" })
    .boundingBox();
  expect(name!.x + name!.width).toBeLessThanOrEqual(theme!.x);
  expect(theme!.x + theme!.width).toBeLessThanOrEqual(settings!.x);
  await page.getByRole("button", { name: "다크 모드로 전환" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(17, 24, 39)",
  );
  await expect(page.locator(".source-registration")).toHaveCSS(
    "background-color",
    "rgb(28, 38, 54)",
  );
  await expect(page.getByLabel("일정 제목 (선택)")).toHaveCSS(
    "background-color",
    "rgb(28, 38, 54)",
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "라이트 모드로 전환" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "캘린더", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".calendar-day:not(.outside-month)").first()).toHaveCSS(
    "color",
    "rgb(230, 237, 247)",
  );
  await page.screenshot({
    path: test.info().outputPath("dark-calendar.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "라이트 모드로 전환" }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "다크 모드로 전환" }),
  ).toBeVisible();
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(246, 247, 249)",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("settings dialog closes by X, Escape and backdrop, clears passwords, and isolates image paste", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  await page.goto("/sources/new");
  const open = page.getByRole("button", { name: "설정 열기", exact: true });
  const dialog = page.getByRole("dialog", { name: "설정", exact: true });
  for (const method of ["x", "escape", "backdrop"]) {
    await open.click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(user.email);
    await dialog
      .getByLabel("현재 비밀번호", { exact: true })
      .fill("private-password");
    await dialog
      .getByLabel("현재 비밀번호", { exact: true })
      .evaluate((input) => {
        const transfer = new DataTransfer();
        transfer.items.add(
          new File(["synthetic"], "paste.png", { type: "image/png" }),
        );
        input.dispatchEvent(
          new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData: transfer,
          }),
        );
      });
    await expect(page.locator(".source-file-list")).toHaveCount(0);
    if (method === "x")
      await dialog.getByRole("button", { name: "설정 닫기" }).click();
    else if (method === "escape") await page.keyboard.press("Escape");
    else await page.mouse.click(2, 2);
    await expect(dialog).not.toBeVisible();
    await expect(open).toBeFocused();
  }
  await open.click();
  await expect(dialog.getByLabel("현재 비밀번호", { exact: true })).toHaveValue(
    "",
  );
  await page.getByRole("button", { name: "설정 닫기" }).click();
});

test("password validation, translated failure, retry, session renewal and pending protection", async ({
  page,
}) => {
  await mockApi(page);
  let expectedToken = "test-only-placeholder",
    requests = 0;
  let release: (() => void) | undefined;
  await page.route("**/test-api/api/auth/me", (route) => {
    expect(route.request().headers().authorization).toBe(
      "Bearer " + expectedToken,
    );
    return route.fulfill({ json: user });
  });
  await page.route("**/test-api/api/auth/password", async (route) => {
    requests++;
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({
      current_password: "old-password-123",
      new_password: "new-password-456",
    });
    if (requests === 1)
      return route.fulfill({
        status: 400,
        json: { detail: "current_password_incorrect" },
      });
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    expectedToken = "renewed-test-only-token";
    await route.fulfill({
      json: {
        access_token: expectedToken,
        token_type: "bearer",
        expires_in: 3600,
      },
    });
  });
  await login(page);
  await page.goto("/sources/new");
  await page.getByRole("button", { name: "설정 열기" }).click();
  const dialog = page.getByRole("dialog", { name: "설정", exact: true });
  const submit = dialog.getByRole("button", {
    name: "비밀번호 변경",
    exact: true,
  });
  await submit.click();
  await expect(dialog.getByRole("alert")).toContainText("현재 비밀번호를 입력");
  await dialog
    .getByLabel("현재 비밀번호", { exact: true })
    .fill("old-password-123");
  await dialog.getByLabel("새 비밀번호", { exact: true }).fill("short");
  await submit.click();
  await expect(dialog.getByRole("alert")).toContainText("8자 이상");
  await dialog
    .getByLabel("새 비밀번호", { exact: true })
    .fill("new-password-456");
  await dialog
    .getByLabel("새 비밀번호 확인", { exact: true })
    .fill("different-password");
  await submit.click();
  await expect(dialog.getByRole("alert")).toContainText("일치하지 않습니다");
  expect(requests).toBe(0);
  await dialog
    .getByLabel("새 비밀번호 확인", { exact: true })
    .fill("new-password-456");
  await submit.click();
  await expect(dialog.getByRole("alert")).toContainText(
    "현재 비밀번호가 맞지 않습니다",
  );
  await submit.click();
  await expect(dialog.getByRole("button", { name: "변경 중…" })).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "설정 닫기" }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.mouse.click(2, 2);
  await expect(dialog).toBeVisible();
  await expect.poll(() => !!release).toBe(true);
  release!();
  await expect(dialog.getByRole("status")).toHaveText(
    "비밀번호를 변경했습니다.",
  );
  await expect(dialog.getByLabel("새 비밀번호", { exact: true })).toHaveValue(
    "",
  );
  expect(requests).toBe(2);
  expect(
    await page.evaluate(() => sessionStorage.getItem("plancatch.access_token")),
  ).toBe(expectedToken);
  await page.screenshot({
    path: test.info().outputPath("password-success.png"),
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "설정 닫기" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "설정 열기" })).toBeVisible();
});

test("theme stays usable when browser storage is blocked", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "localStorage", {
      value: {
        getItem() {
          throw new Error("storage blocked");
        },
        setItem() {
          throw new Error("storage blocked");
        },
      },
    }),
  );
  await mockApi(page);
  await login(page);
  await page.goto("/sources/new");
  await page.getByRole("button", { name: "다크 모드로 전환" }).click();
  await expect(
    page.getByRole("button", { name: "라이트 모드로 전환" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "라이트 모드로 전환" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
