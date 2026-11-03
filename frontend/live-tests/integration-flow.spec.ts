import { randomBytes } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import type { Analysis } from "../types/analysis";

const upstream = process.env.PLANCATCH_LIVE_API_URL?.trim().replace(/\/$/, "");

// Runs only against an explicitly supplied API, with a newly created test owner.
// The live config disables traces, screenshots and videos containing credentials.
async function ownRequest(
  page: Page,
  path: string,
  method = "GET",
  body?: object,
) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const response = await fetch(`/test-api${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${sessionStorage.getItem("plancatch.access_token")}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return {
        status: response.status,
        data: response.status === 204 ? null : await response.json(),
      };
    },
    { path, method, body },
  );
}

function testPdf(day: string) {
  // A real one-page PDF with synthetic text, never a user's document.
  const stream = [
    "BT /F1 18 Tf 50 750 Td (2026 PlanCatch Integration Test) Tj",
    "0 -35 Td /F1 12 Tf (Company: PlanCatch Test Company) Tj",
    `0 -30 Td (Application deadline: ${day} 18:00 Korea time.) Tj`,
    "0 -30 Td (This is synthetic test data, not a real recruitment.) Tj ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
    .join("")}`;
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

test("current integrated UI: real signup, consent, text/PDF review, persistence, manual schedule and calendar", async ({
  page,
}) => {
  test.setTimeout(300000);
  if (!upstream)
    throw new Error(
      "PLANCATCH_LIVE_API_URL is required for explicit live testing",
    );
  const marker = `[테스트] 통합 확인 ${randomBytes(5).toString("hex")}`;
  const email = `plancatch-test-${randomBytes(8).toString("hex")}@example.com`;
  const password = randomBytes(24).toString("base64url");
  const day = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const sources = new Set<string>();
  const deadlines = new Set<string>();
  const tasks = new Set<string>();
  let analysisPosts = 0;
  await page.route("**/test-api/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname.endsWith("/ai-analyses"))
      analysisPosts++;
    const response = await route.fetch({
      url: `${upstream}${url.pathname.replace("/test-api", "")}${url.search}`,
      timeout: 90000,
    });
    // Track server-created IDs before UI assertions, so failures still clean up.
    if (request.method() === "POST" && response.status() === 201) {
      const path = url.pathname.replace("/test-api", "");
      if (
        [
          "/api/sources",
          "/api/sources/pdfs",
          "/api/tasks",
          "/api/deadlines",
        ].includes(path)
      ) {
        const data = await response.json();
        (path.startsWith("/api/sources")
          ? sources
          : path === "/api/tasks"
            ? tasks
            : deadlines
        ).add(data.id);
      }
    }
    if (
      request.method() === "POST" &&
      url.pathname.endsWith("/approve") &&
      response.ok()
    ) {
      const data = await response.json();
      for (const id of data.approved_deadline_ids ?? []) deadlines.add(id);
    }
    await route.fulfill({ response });
  });
  await page.goto("/signup");
  await page.getByLabel("이름 (선택)").fill("[테스트] 전용 통합 확인");
  await page.getByLabel("이메일", { exact: true }).fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByLabel("비밀번호 확인", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "계정 만들기 →", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "가입이 완료되었습니다.", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "로그인으로 이동", exact: true })
    .click();
  await page.getByLabel("이메일", { exact: true }).fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByRole("button", { name: "로그인 →", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  console.info("Live integration: dedicated test owner signed in");

  async function newSource() {
    await page
      .getByRole("link", { name: "새 일정 등록하기", exact: true })
      .click();
    await expect(page).toHaveURL(/\/sources\/new\?new=/);
    await expect(
      page.getByRole("link", { name: "원본 자료", exact: true }),
    ).not.toHaveAttribute("aria-current", "page");
  }
  async function saveSource() {
    const created = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        /\/api\/sources(?:\/pdfs)?$/.test(new URL(response.url()).pathname),
    );
    await page.getByRole("button", { name: "자료 저장", exact: true }).click();
    const response = await created;
    expect(response.status()).toBe(201);
    const { id } = await response.json();
    await expect(page).toHaveURL(
      /\/(?:sources\/[^/]+\/review|analyses\/[^/]+)$/,
    );
    return id as string;
  }
  async function consent(before: number) {
    const start = page.getByRole("button", {
      name: "동의하고 AI 검토 시작",
      exact: true,
    });
    await expect(start).toBeDisabled();
    expect(analysisPosts).toBe(before);
    await page.getByRole("checkbox", { name: /Google Gemini/ }).check();
    await start.click();
    await expect(page).toHaveURL(/\/analyses\//);
    await expect(page.getByLabel("후보 1 제목", { exact: true })).toBeVisible({
      timeout: 95000,
    });
    expect(analysisPosts).toBe(before + 1);
    return new URL(page.url()).pathname.split("/").at(-1)!;
  }
  try {
    await newSource();
    await page.getByLabel("일정 제목 (선택)").fill(`${marker} 텍스트`);
    await page
      .getByLabel("원본 텍스트", { exact: true })
      .fill(
        `회사명: 플랜캐치 테스트회사\n[테스트] 보고서 제출\n제출 마감일: ${day} 오후 6시 (한국 시간)\n실제 채용이나 과제가 아닌 합성 검증 자료입니다.`,
      );
    await saveSource();
    const analysisId = await consent(0);
    const current = await ownRequest(page, `/api/ai-analyses/${analysisId}`);
    expect(current.status).toBe(200);
    const ready = current.data as Analysis;
    expect(ready.status).toBe("ready");
    expect(ready.candidates.length).toBeGreaterThan(0);
    for (let index = 0; index < ready.candidates.length; index++)
      await page
        .getByLabel(`후보 ${index + 1} 포함`, { exact: true })
        .setChecked(index === 0);
    await page
      .getByLabel("후보 1 제목", { exact: true })
      .fill(`${marker} 승인 마감`);
    await page
      .getByLabel("후보 1 마감일 (한국 시간)", { exact: true })
      .fill(`${day}T18:00`);
    await page
      .getByRole("button", { name: "선택한 1개 일정 등록", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "마감일 등록 완료", exact: true }),
    ).toBeVisible();
    const approved = await ownRequest(page, `/api/ai-analyses/${analysisId}`);
    expect(approved.data.approved_deadline_ids).toHaveLength(1);
    const deadlineId = approved.data.approved_deadline_ids[0] as string;
    deadlines.add(deadlineId);
    const duplicate = await ownRequest(
      page,
      `/api/ai-analyses/${analysisId}/approve`,
      "POST",
      { revision: approved.data.revision },
    );
    expect(duplicate.status).toBe(200);
    expect(duplicate.data.approved_deadline_ids).toEqual([deadlineId]);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "마감일 등록 완료", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "생성된 마감일 1 보기 →", exact: true })
      .click();
    await page
      .getByLabel("마감 제목", { exact: true })
      .fill(`${marker} 수정 마감`);
    await page
      .getByRole("button", { name: "변경 사항 저장", exact: true })
      .click();
    await expect(
      page.getByText("변경 사항을 저장했습니다.", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("마감 제목", { exact: true })).toHaveValue(
      `${marker} 수정 마감`,
    );
    const saved = await ownRequest(page, `/api/deadlines/${deadlineId}`);
    expect(saved.status).toBe(200);
    expect(Date.parse(saved.data.due_at)).toBe(
      Date.parse(`${day}T18:00:00+09:00`),
    );
    const sync = await ownRequest(
      page,
      `/api/integrations/google-calendar/auto-sync?kind=deadline&item_id=${deadlineId}`,
    );
    expect(sync.status).toBe(200);
    expect(sync.data.state).toBe("not_connected");
    console.info(
      "Live integration: text consent, edited approval, reload and duplicate protection passed",
    );

    await newSource();
    await page.getByLabel("일정 제목 (선택)").fill(`${marker} PDF`);
    await page
      .getByLabel("PDF 또는 이미지 파일 입력", { exact: true })
      .setInputFiles({
        name: "[테스트] 통합 확인.pdf",
        mimeType: "application/pdf",
        buffer: testPdf(day),
      });
    await saveSource();
    const pdfAnalysisId = await consent(1);
    const pdfResult = await ownRequest(
      page,
      `/api/ai-analyses/${pdfAnalysisId}`,
    );
    expect(pdfResult.data.model).toMatch(/^pdf:/);
    expect(pdfResult.data.input_text.length).toBeGreaterThan(0);
    await page.getByRole("button", { name: "전체 거부", exact: true }).click();
    await page
      .getByRole("button", { name: "전체 거부 확인", exact: true })
      .click();
    await expect(
      page.getByText(
        "분석 결과를 전체 거부했습니다. 이 분석으로 생성된 마감일은 없습니다.",
        { exact: true },
      ),
    ).toBeVisible();
    console.info(
      "Live integration: real PDF upload, consent, analysis and rejection passed",
    );

    await newSource();
    await page.getByLabel("일정 제목 (선택)").fill(`${marker} 공개 URL`);
    await page
      .getByLabel("원본 URL", { exact: true })
      .fill("https://example.com");
    const urlSourceId = await saveSource();
    await expect
      .poll(
        async () => {
          const result = await ownRequest(page, `/api/sources/${urlSourceId}`);
          return result.data.processing_status;
        },
        { timeout: 95000, intervals: [2000] },
      )
      .toBe("extracted");
    await newSource();
    await page.getByLabel("일정 제목 (선택)").fill(`${marker} 접근 제한 URL`);
    await page.getByLabel("원본 URL", { exact: true }).fill("http://127.0.0.1");
    await saveSource();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "보안 정책상 접근할 수 없는 URL" }),
    ).toBeVisible({ timeout: 95000 });
    console.info(
      "Live integration: public URL extraction and restricted URL error passed",
    );

    await newSource();
    await page
      .getByRole("tab", { name: "수동 일정 등록", exact: true })
      .click();
    await page
      .getByLabel("일정명", { exact: true })
      .fill(`${marker} 수동 일정`);
    await page.getByLabel("시작 일시", { exact: true }).fill(`${day}T15:00`);
    await page.getByLabel("종료 일시", { exact: true }).fill(`${day}T16:00`);
    await page.getByRole("button", { name: "일정 등록", exact: true }).click();
    await expect(page).toHaveURL(/\/tasks\/[^/]+$/);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: `${marker} 수동 일정`, exact: true }),
    ).toBeVisible();
    await page.goto("/calendar");
    await page.getByLabel("기준 날짜", { exact: true }).fill(day);
    await expect(
      page.getByText(`${marker} 수동 일정`, { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText(`${marker} 수정 마감`, { exact: true }).first(),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.goto("/settings/google-calendar");
    await expect(
      page.getByText("아직 연결하지 않았습니다", { exact: true }),
    ).toBeVisible();
    console.info(
      "Live integration: manual schedule and approved deadline appear in calendar; Google stays unconnected",
    );
  } finally {
    // There is no account deletion endpoint. Only this run's sources and schedules are deleted.
    const failures: string[] = [];
    for (const [kind, ids] of [
      ["deadlines", deadlines],
      ["tasks", tasks],
      ["sources", sources],
    ] as const) {
      for (const id of ids) {
        const result = await ownRequest(page, `/api/${kind}/${id}`, "DELETE");
        if (![204, 404].includes(result.status))
          failures.push(`${kind}: ${result.status}`);
      }
    }
    expect(failures, "Remove only this run's own synthetic records").toEqual(
      [],
    );
    console.info(
      "Live integration: owned synthetic sources and schedules removed; dedicated test account remains",
    );
  }
  await page.getByRole("button", { name: "로그아웃 ↗", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(
    await page.evaluate(() => sessionStorage.getItem("plancatch.access_token")),
  ).toBeNull();
  await page.goto("/calendar");
  await expect(page).toHaveURL(/\/login/);
});
