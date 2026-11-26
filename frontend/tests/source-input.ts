import type { Page } from "@playwright/test";

/** Registration tabs preserve drafts; source editing keeps its existing labels. */
export async function sourceInput(page: Page, kind: "file" | "url" | "text") {
  const names = {
    file: ["PDF 또는 이미지 파일 입력", "PDF 또는 이미지 파일 입력"],
    url: ["웹페이지 주소 (URL)", "웹페이지 링크"],
    text: ["안내문·메모 내용", "글 내용"],
  }[kind];
  const field = page
    .getByLabel(names[0], { exact: true })
    .or(page.getByLabel(names[1], { exact: true }))
    .first();
  await field.waitFor({ state: "attached" });
  const tabs = page.getByRole("tablist", {
    name: "자료 입력 방식",
    exact: true,
  });
  if (await tabs.count()) {
    const tab = tabs.getByRole("tab", {
      name: {
        file: /^파일 올리기/,
        url: /^웹페이지 링크/,
        text: /^글 내용 붙여넣기/,
      }[kind],
    });
    if (await tab.isEnabled()) await tab.click();
  }
  return field;
}
