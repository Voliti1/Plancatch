import { test, expect } from "@playwright/test";
import { login } from "./fixtures";
import { mockAnalyses, aiSource, readyAnalysis } from "./analysis-fixtures";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=",
  "base64",
);
const image = {
  ...aiSource,
  source_type: "image",
  title: null,
  original_text: null,
  extracted_text: null,
  image_sha256: "a".repeat(64),
  processing_status: "pending",
};
const result = {
  ...readyAnalysis,
  model: "image:test-model",
  input_hash: image.image_sha256,
  input_text: "접수기간 2026년 10월 21일 ~ 11월 1일 까지",
  warnings: ["사진에 마감 시각이 없습니다."],
  candidates: [
    {
      ...readyAnalysis.candidates[0],
      title: "접수 마감",
      due_at: null,
      selected: false,
      evidence_text: "접수기간 2026년 10월 21일 ~ 11월 1일 까지",
    },
  ],
  date_choices: [
    {
      id: "image-date",
      raw_text: "11월 1일",
      date: "2026-11-01",
      due_at: null,
      evidence_text: "접수기간 2026년 10월 21일 ~ 11월 1일 까지",
    },
  ],
};

test("image upload requires consent, preserves missing time and original preview, then explicit edit/save/approval", async ({
  page,
}) => {
  const state = await mockAnalyses(page, [], image);
  let uploads = 0;
  await page.route("**/test-api/api/sources/images", (route) => {
    expect(route.request().headers()["content-type"]).toContain(
      "multipart/form-data; boundary=",
    );
    uploads++;
    return route.fulfill({ status: 201, json: image });
  });
  await page.route("**/test-api/api/sources/ai-source/image", (route) =>
    route.fulfill({ body: png, contentType: "image/png" }),
  );
  await page.route("**/test-api/api/sources/ai-source/ai-analyses", (route) => {
    expect(route.request().postDataJSON()).toEqual({
      allow_external_ai: true,
      input_hash: image.image_sha256,
      reuse_existing: true,
    });
    state.starts++;
    state.analyses.push(structuredClone(result));
    return route.fulfill({ status: 202, json: result });
  });
  await login(page);
  await page.goto("/sources/new");
  await page
    .getByLabel("PNG·JPG 이미지 입력", { exact: true })
    .setInputFiles({ name: "캡처.png", mimeType: "image/png", buffer: png });
  expect(uploads).toBe(0);
  await page.getByRole("button", { name: "자료 저장", exact: true }).click();
  await expect(page).toHaveURL(/\/sources\/ai-source\/review$/);
  const consent = page.getByRole("checkbox");
  await expect(
    page.getByRole("button", { name: "동의하고 AI 검토 시작" }),
  ).toBeDisabled();
  await expect(page.getByRole("img")).toBeVisible();
  expect(state.starts).toBe(0);
  await consent.check();
  await page.getByRole("button", { name: "동의하고 AI 검토 시작" }).click();
  await expect(page).toHaveURL(/\/analyses\/analysis-1$/);
  await expect(page.getByRole("region", { name: "원본 이미지" })).toBeVisible();
  await expect(
    page.getByLabel("후보 1 마감일 (한국 시간)", { exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "11월 1일 · 일시 입력 필요" }),
  ).toBeVisible();
  expect(state.deadlines).toHaveLength(0);
  await page
    .getByLabel("후보 1 제목", { exact: true })
    .fill("직접 입력한 제목");
  await page
    .getByLabel("후보 1 마감일 (한국 시간)", { exact: true })
    .fill("2026-11-01T18:00");
  await page.getByRole("checkbox", { name: "후보 1 포함" }).check();
  await page
    .getByRole("button", { name: "검토 내용 저장", exact: true })
    .click();
  await page
    .getByRole("button", { name: "선택한 1개 승인", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "마감일 등록 완료" }),
  ).toBeVisible();
  expect(state.deadlines).toHaveLength(1);
  expect(state.deadlines[0].title).toBe("직접 입력한 제목");
  expect(state.starts).toBe(1);
  expect(uploads).toBe(1);
  await page.goto("/sources/ai-source/review");
  await expect(page).toHaveURL(/\/analyses\/analysis-1$/);
  expect(state.starts).toBe(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("image-review.png"),
    fullPage: true,
  });
});
