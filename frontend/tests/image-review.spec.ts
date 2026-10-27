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
    .getByLabel("이미지 파일 입력", { exact: true })
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

for (const scenario of [
  {
    name: "사진의 오후 5시 유지",
    stored: "2026-10-27T17:00:00+09:00",
    suggested: null,
    expected: "2026-10-27T17:00",
    defaulted: false,
  },
  {
    name: "시간 없는 날짜는 23:59",
    stored: "2026-11-01T23:59:00+09:00",
    suggested: null,
    expected: "2026-11-01T23:59",
    defaulted: true,
  },
  {
    name: "이전 미확정 결과 복구",
    stored: null,
    suggested: "2026-10-27T17:00:00+09:00",
    expected: "2026-10-27T17:00",
    defaulted: false,
  },
  {
    name: "이전 시간 없는 결과 복구",
    stored: null,
    suggested: "2026-11-01T23:59:00+09:00",
    expected: "2026-11-01T23:59",
    defaulted: true,
  },
]) {
  test(`${scenario.name}: 자동 입력 후 직접 선택·저장·승인`, async ({
    page,
  }) => {
    const candidate = {
      ...result.candidates[0],
      due_at: scenario.stored,
      suggested_due_at: scenario.suggested,
      time_defaulted: scenario.defaulted,
    };
    const analysis = {
      ...result,
      candidates: [candidate],
      warnings: [
        "마감 시간(시, 분)이 명시되어 있지 않아 due_at을 null로 처리했습니다.",
      ],
      date_choices: [],
    };
    const state = await mockAnalyses(page, [analysis], image);
    await page.route("**/test-api/api/sources/ai-source/image", (route) =>
      route.fulfill({ body: png, contentType: "image/png" }),
    );
    await login(page);
    await page.goto("/analyses/analysis-1");
    await expect(
      page.getByLabel("후보 1 마감일 (한국 시간)", { exact: true }),
    ).toHaveValue(scenario.expected);
    await expect(
      page.getByRole("button", { name: "선택한 0개 승인", exact: true }),
    ).toBeDisabled();
    await expect(page.locator("body")).not.toContainText("due_at");
    await expect(page.locator("body")).not.toContainText("null");
    if (scenario.defaulted)
      await expect(
        page.getByText(
          "마감 시간이 없어 오후 11시 59분으로 설정했습니다. 필요하면 변경해 주세요.",
          { exact: true },
        ),
      ).toBeVisible();
    if (scenario.suggested)
      await expect(
        page.getByRole("button", { name: "검토 내용 저장", exact: true }),
      ).toBeEnabled();
    await page.screenshot({
      path: test.info().outputPath("deadline-time-review.png"),
      fullPage: true,
    });
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
    expect(state.deadlines[0].due_at).toBe(
      scenario.stored ?? scenario.suggested,
    );
    expect(state.starts).toBe(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath("deadline-time.png"),
      fullPage: true,
    });
  });
}

test("이전 결과에 제안된 날짜를 지워서 저장하면 다시 채우지 않는다", async ({
  page,
}) => {
  const candidate = {
    ...result.candidates[0],
    suggested_due_at: "2026-10-27T17:00:00+09:00",
  };
  const state = await mockAnalyses(
    page,
    [{ ...result, candidates: [candidate] }],
    image,
  );
  await page.route("**/test-api/api/sources/ai-source/image", (route) =>
    route.fulfill({ body: png, contentType: "image/png" }),
  );
  await page.route("**/test-api/api/ai-analyses/analysis-1", (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    const edit = route.request().postDataJSON().candidates[0];
    expect(edit.due_at).toBeNull();
    state.analyses[0] = {
      ...state.analyses[0],
      revision: 2,
      candidates: [{ ...candidate, ...edit, suggested_due_at: null }],
    };
    return route.fulfill({ json: state.analyses[0] });
  });
  await login(page);
  await page.goto("/analyses/analysis-1");
  const input = page.getByLabel("후보 1 마감일 (한국 시간)", { exact: true });
  await expect(input).toHaveValue("2026-10-27T17:00");
  await input.fill("");
  await page
    .getByRole("button", { name: "검토 내용 저장", exact: true })
    .click();
  await expect(
    page.getByText("검토 내용을 저장했습니다.", { exact: true }),
  ).toBeVisible();
  await expect(input).toHaveValue("");
  await page.reload();
  await expect(
    page.getByLabel("후보 1 마감일 (한국 시간)", { exact: true }),
  ).toHaveValue("");
  expect(state.starts).toBe(0);
});
