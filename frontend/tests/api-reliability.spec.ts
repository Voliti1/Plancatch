import { test, expect } from "@playwright/test";
import { api, ApiError } from "../lib/api/client";
import { analysisError, processingError } from "../features/analyses/errors";

test("unexpected error bodies retain HTTP status and a usable message", async () => {
  const original = globalThis.fetch;
  try {
    for (const body of [
      null,
      false,
      5,
      "text",
      {},
      { detail: [] },
      { detail: [null, false, 3, { msg: null }] },
    ]) {
      globalThis.fetch = async () =>
        new Response(JSON.stringify(body), { status: 422 });
      await expect(api("/synthetic", {}, false)).rejects.toMatchObject({
        status: 422,
        message: "요청을 처리하지 못했습니다.",
      });
    }
    globalThis.fetch = async () =>
      new Response("<html>bad gateway</html>", { status: 502 });
    await expect(api("/synthetic", {}, false)).rejects.toMatchObject({
      status: 502,
      message: "요청을 처리하지 못했습니다.",
    });
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          detail: [
            null,
            { msg: "제목이 필요합니다." },
            { msg: 3 },
            { msg: "시간을 확인해 주세요." },
          ],
        }),
        { status: 422 },
      );
    await expect(api("/synthetic", {}, false)).rejects.toMatchObject({
      status: 422,
      message: "제목이 필요합니다. / 시간을 확인해 주세요.",
    });
  } finally {
    globalThis.fetch = original;
  }
});

test("successful writes with unreadable bodies remain uncertain without automatic resubmission", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      return new Response("<html>response lost</html>", { status: 201 });
    };
    const result = await api(
      "/synthetic",
      { method: "POST", body: "{}" },
      false,
    ).catch((error) => error);
    expect(result).toBeInstanceOf(ApiError);
    if (!(result instanceof ApiError))
      throw new Error("Expected a safe API failure");
    expect(result.status).toBe(0);
    expect(result.message).toContain("저장 여부를 확인");
    expect(calls).toBe(1);
  } finally {
    globalThis.fetch = original;
  }
});

test("ordinary JSON, blob, empty delete and authentication failures keep their contracts", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('{"ok":true}');
    await expect(api("/synthetic", {}, false)).resolves.toEqual({ ok: true });
    globalThis.fetch = async () => new Response("image-data");
    expect(
      await (await api<Blob>("/synthetic", {}, false, "blob")).text(),
    ).toBe("image-data");
    globalThis.fetch = async () => new Response(null, { status: 204 });
    await expect(
      api("/synthetic", { method: "DELETE" }, false),
    ).resolves.toBeUndefined();
    globalThis.fetch = async () => new Response("null", { status: 401 });
    await expect(api("/synthetic", {}, false)).rejects.toMatchObject({
      status: 401,
    });
  } finally {
    globalThis.fetch = original;
  }
});

test("complex HTML has the same plain-language explanation across extraction and analysis", () => {
  expect(processingError("html_too_complex")).toContain("텍스트나 캡처");
  expect(analysisError(new ApiError("html_too_complex", 422))).toBe(
    processingError("html_too_complex"),
  );
});

test("malformed login replies stay readable, preserve inputs and never resubmit automatically", async ({
  page,
}) => {
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));
  let calls = 0;
  await page.route("**/api/auth/login", (route) => {
    calls++;
    return route.fulfill({
      status: calls === 1 ? 422 : 201,
      contentType: calls === 1 ? "application/json" : "text/html",
      body: calls === 1 ? "null" : "<html>incomplete response</html>",
    });
  });
  await page.goto("/login");
  await page.getByLabel("이메일", { exact: true }).fill("test@example.com");
  await page.getByLabel("비밀번호", { exact: true }).fill("Test-password-123");
  await page.getByRole("button", { name: "로그인 →" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "요청을 처리하지 못했습니다" }),
  ).toBeVisible();
  expect(calls).toBe(1);
  await page.getByRole("button", { name: "로그인 →" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "저장 여부를 확인" }),
  ).toBeVisible();
  await expect(page.getByLabel("이메일", { exact: true })).toHaveValue(
    "test@example.com",
  );
  await expect(page.getByLabel("비밀번호", { exact: true })).toHaveValue(
    "Test-password-123",
  );
  expect(calls).toBe(2);
  expect(crashes).toEqual([]);
});
