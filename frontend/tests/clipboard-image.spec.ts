import { test, expect, type Page } from "@playwright/test";
import { login, mockApi } from "./fixtures";
import { aiSource, mockAnalyses } from "./analysis-fixtures";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=",
  "base64",
);
const image = {
  ...aiSource,
  id: "clipboard-source",
  source_type: "image",
  title: null,
  original_text: null,
  extracted_text: null,
  processing_status: "pending",
  image_sha256: "a".repeat(64),
};

// Exercise the actual browser paste event without reading or overwriting the user's OS clipboard.
async function paste(
  page: Page,
  files: { name: string; type: string; size?: number }[],
  target = "body",
  text?: string,
) {
  return page.evaluate(
    ({ files, target, text, bytes }) => {
      const data = new DataTransfer();
      for (const file of files)
        data.items.add(
          new File(
            [
              file.size === undefined
                ? new Uint8Array(bytes)
                : new Uint8Array(file.size),
            ],
            file.name,
            { type: file.type },
          ),
        );
      if (text) data.setData("text/plain", text);
      const event = new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      });
      return document.querySelector(target)!.dispatchEvent(event);
    },
    { files, target, text, bytes: Array.from(png) },
  );
}
async function open(page: Page) {
  await mockApi(page);
  await login(page);
  await page.goto("/sources/new");
  await expect(
    page.getByRole("button", { name: "이미지 파일 선택", exact: true }),
  ).toBeEnabled();
}

test("붙여넣은 캡처는 저장 전 전송하지 않고 저장 후 AI 동의를 받는다", async ({
  page,
}) => {
  const state = await mockAnalyses(page, [], image);
  let uploads = 0;
  await page.route("**/test-api/api/sources/images", (route) => {
    uploads++;
    expect(route.request().headers()["content-type"]).toContain(
      "multipart/form-data; boundary=",
    );
    return route.fulfill({ status: 201, json: image });
  });
  await page.route("**/test-api/api/sources/clipboard-source/image", (route) =>
    route.fulfill({ body: png, contentType: "image/png" }),
  );
  await login(page);
  await page.goto("/sources/new");
  await expect(
    page.getByRole("button", { name: "이미지 파일 선택", exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel("일정 제목 (선택)", { exact: true })
    .fill("내가 입력한 제목");
  expect(
    await paste(page, [{ name: "", type: "image/png" }], 'input[name="title"]'),
  ).toBe(false);
  await expect(page.getByRole("list", { name: "선택한 파일" })).toContainText(
    "클립보드 이미지.png",
  );
  await expect(page.getByRole("list", { name: "선택한 파일" })).toContainText(
    "KB",
  );
  await expect(
    page.getByLabel("일정 제목 (선택)", { exact: true }),
  ).toHaveValue("내가 입력한 제목");
  expect(uploads).toBe(0);
  expect(state.starts).toBe(0);
  await page.screenshot({
    path: test.info().outputPath("clipboard-selected.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "자료 저장", exact: true }).click();
  await expect(page).toHaveURL(/\/sources\/clipboard-source\/review$/);
  await expect(
    page.getByRole("button", { name: "동의하고 AI 검토 시작" }),
  ).toBeDisabled();
  expect(uploads).toBe(1);
  expect(state.starts).toBe(0);
});

test("본문과 입력칸에서 이미지 붙여넣기·교체·제거가 동작하고 URL과 텍스트는 유지한다", async ({
  page,
}) => {
  await open(page);
  await page
    .getByLabel("원본 URL", { exact: true })
    .fill("https://example.com/job");
  await page.getByLabel("원본 텍스트", { exact: true }).fill("작성 중인 안내");
  expect(await paste(page, [{ name: "첫 캡처.png", type: "image/png" }])).toBe(
    false,
  );
  const list = page.getByRole("list", { name: "선택한 파일" });
  await expect(list.getByRole("listitem")).toHaveCount(1);
  expect(
    await paste(
      page,
      [{ name: "두번째 캡처.png", type: "image/png" }],
      'textarea[name="text"]',
    ),
  ).toBe(false);
  await expect(list).toContainText("두번째 캡처.png");
  await expect(list).not.toContainText("첫 캡처.png");
  await expect(page.getByLabel("원본 URL", { exact: true })).toHaveValue(
    "https://example.com/job",
  );
  await expect(page.getByLabel("원본 텍스트", { exact: true })).toHaveValue(
    "작성 중인 안내",
  );
  expect(
    await paste(page, [], 'input[name="url"]', "https://example.com/another"),
  ).toBe(true);
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await page
    .getByRole("button", { name: "두번째 캡처.png 제거", exact: true })
    .click();
  await expect(list).toHaveCount(0);
});

for (const invalid of [
  {
    name: "too-big.png",
    type: "image/png",
    size: 5 * 1024 * 1024 + 1,
    error: "5MB 이하여야",
  },
  { name: "empty.png", type: "image/png", size: 0, error: "5MB 이하여야" },
  {
    name: "notice.svg",
    type: "image/svg+xml",
    size: 10,
    error: "HEIC·SVG·PDF는 아직 지원하지 않습니다",
  },
])
  test(`잘못된 클립보드 이미지 ${invalid.name}는 기존 선택을 덮지 않는다`, async ({
    page,
  }) => {
    await open(page);
    await paste(page, [{ name: "보존할 캡처.png", type: "image/png" }]);
    await paste(page, [invalid]);
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      invalid.error,
    );
    await expect(page.getByRole("list", { name: "선택한 파일" })).toContainText(
      "보존할 캡처.png",
    );
  });

test("여러 사진은 거부하며 수동 등록·다른 페이지에서는 붙여넣기를 가로채지 않는다", async ({
  page,
}) => {
  await open(page);
  await paste(page, [
    { name: "1.png", type: "image/png" },
    { name: "2.png", type: "image/png" },
  ]);
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "한 장씩",
  );
  await expect(page.getByRole("list", { name: "선택한 파일" })).toHaveCount(0);
  await page.getByRole("tab", { name: "수동 일정 등록", exact: true }).click();
  expect(await paste(page, [{ name: "hidden.png", type: "image/png" }])).toBe(
    true,
  );
  await page.getByRole("tab", { name: "자료로 등록", exact: true }).click();
  await expect(page.getByRole("list", { name: "선택한 파일" })).toHaveCount(0);
  await paste(page, [{ name: "visible.png", type: "image/png" }]);
  await expect(
    page.getByRole("list", { name: "선택한 파일" }).getByRole("listitem"),
  ).toHaveCount(1);
  await page.goto("/dashboard");
  await expect(
    page.getByRole("main").getByRole("heading", { level: 1 }),
  ).toBeVisible();
  expect(
    await paste(page, [{ name: "elsewhere.png", type: "image/png" }]),
  ).toBe(true);
});

test("저장 중에는 다른 캡처를 가로채지 않고 실패 후에는 다시 붙일 수 있다", async ({
  page,
}) => {
  await open(page);
  let release = () => {};
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/test-api/api/sources/images", async (route) => {
    await waiting;
    return route.fulfill({ status: 503, json: { detail: "검사용 저장 실패" } });
  });
  await paste(page, [{ name: "저장할 이미지.png", type: "image/png" }]);
  await page.getByRole("button", { name: "자료 저장", exact: true }).click();
  try {
    await expect(
      page.getByRole("button", { name: "저장 중…", exact: true }),
    ).toBeDisabled();
    expect(
      await paste(page, [{ name: "끼어든 이미지.png", type: "image/png" }]),
    ).toBe(true);
    await expect(page.getByRole("list", { name: "선택한 파일" })).toContainText(
      "저장할 이미지.png",
    );
  } finally {
    release();
  }
  await expect(
    page.getByRole("button", { name: "자료 저장", exact: true }),
  ).toBeEnabled();
  expect(
    await paste(page, [{ name: "다시 시도.png", type: "image/png" }]),
  ).toBe(false);
  await expect(page.getByRole("list", { name: "선택한 파일" })).toContainText(
    "다시 시도.png",
  );
});
