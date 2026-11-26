import { expect, test } from "@playwright/test";
import { login, mockApi } from "./fixtures";
import { aiSource, mockAnalyses, readyAnalysis } from "./analysis-fixtures";

for (const count of [0, 1, 9]) {
  test(`분석 기록 ${count}개일 때 불필요한 페이지 이동을 숨긴다`, async ({
    page,
  }) => {
    await mockAnalyses(
      page,
      Array.from({ length: count }, (_, i) => ({
        ...readyAnalysis,
        id: `history-${i}`,
      })),
    );
    await login(page);
    await page.goto("/sources/ai-source");
    const history = page.locator(".analysis-history");
    if (count) await expect(history.getByRole("link")).toHaveCount(count);
    else
      await expect(
        history.getByRole("heading", { name: "분석 기록이 없어요" }),
      ).toBeVisible();
    await expect(
      history.getByRole("button", { name: /이전 기록|다음 기록/ }),
    ).toHaveCount(0);
  });
}

for (const length of [30000, 30001]) {
  test(`자료 ${length}자의 분석 한도 안내는 필요할 때만 표시한다`, async ({
    page,
  }) => {
    const text = "가".repeat(length);
    await mockAnalyses(page, [], {
      ...aiSource,
      original_text: text,
      extracted_text: text,
    });
    await login(page);
    await page.goto("/sources/ai-source");
    const launch = page.locator(".analysis-launch");
    await expect(
      launch.getByRole("heading", { name: "2. AI 마감일 분석" }),
    ).toBeVisible();
    await expect(launch.getByText(/분석 한도 40,000자/)).toHaveCount(
      length > 30000 ? 1 : 0,
    );
    await expect(
      launch.getByRole("button", { name: "AI 분석 시작", exact: true }),
    ).toBeDisabled();
  });
}

for (const identical of [true, false]) {
  test(`텍스트 자료의 입력 내용과 불러온 내용이 ${identical ? "같으면 중복을 숨기고" : "다르면 둘 다"} 표시한다`, async ({
    page,
  }) => {
    await mockAnalyses(page, [], {
      ...aiSource,
      original_text: identical
        ? aiSource.extracted_text
        : "[테스트] 수정 전 글 내용",
    });
    await login(page);
    await page.goto("/sources/ai-source");
    await expect(
      page.getByRole("region", { name: "추출된 내용", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "글 내용", exact: true }),
    ).toHaveCount(identical ? 0 : 1);
    await page
      .getByRole("button", { name: "자세히 보기", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText(
      aiSource.extracted_text!,
    );
  });
}

test("링크 지원 안내를 접어도 직접 확인 동의는 항상 보인다", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  await page.goto("/deadlines/auto");
  const summary = page.getByText("지원되는 링크 및 주의사항 보기", {
    exact: true,
  });
  const details = page.locator("details").filter({ has: summary });
  await expect(summary).toBeVisible();
  await expect(details).not.toHaveAttribute("open");
  await expect(details.getByText(/외부 AI에 내용을 보내지/)).not.toBeVisible();
  await expect(
    page.getByRole("checkbox", {
      name: "페이지에서 찾은 날짜를 자료와 비교한 뒤 등록할게요.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "일정 등록", exact: true }),
  ).toBeDisabled();
  await summary.press("Enter");
  await expect(details).toHaveAttribute("open", "");
  await expect(details).toContainText("외부 AI에 내용을 보내지");
});
