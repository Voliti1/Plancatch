import { expect, type Page } from "@playwright/test";

// Existing form tests enter edit mode through the same button as a user.
export async function deadlineField(
  page: Page,
  name: string | RegExp,
  options?: { exact?: boolean },
) {
  const field = page.getByLabel(name, options);
  const summary = page.getByRole("region", {
    name: "마감일 요약",
    exact: true,
  });
  await expect
    .poll(async () => {
      if (!(await summary.isVisible())) return await field.isVisible();
      const edit = summary.getByRole("button", { name: "수정", exact: true });
      if (await edit.isVisible()) await edit.click();
      const title = summary.getByLabel("마감 제목", { exact: true });
      return (await title.isVisible()) && (await title.isEnabled());
    })
    .toBe(true);
  return field;
}
