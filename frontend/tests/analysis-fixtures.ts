// Synthetic test-only sources and AI responses; never imported by production code.
import { expect, type Page } from "@playwright/test";
import { mockApi } from "./fixtures";
import type { Source, Deadline } from "../types/api";
import type { Analysis, CandidateEdit } from "../types/analysis";
export const aiSource: Source = {
  id: "ai-source",
  title: "[테스트] 마감 안내",
  source_type: "text",
  original_url: null,
  original_text:
    "2026년 10월 1일 오전 9시(한국 시간) 보고서 제출. 다음 발표 날짜는 미정입니다.",
  extracted_text:
    "2026년 10월 1일 오전 9시(한국 시간) 보고서 제출. 다음 발표 날짜는 미정입니다.",
  storage_key: null,
  processing_status: "extracted",
  error_message: null,
  created_at: "2026-09-30T00:00:00Z",
  updated_at: "2026-09-30T00:00:00Z",
};
export const readyAnalysis: Analysis = {
  id: "analysis-1",
  source_id: aiSource.id,
  input_text: aiSource.extracted_text!,
  model: "test-only-synthetic",
  status: "ready",
  revision: 1,
  candidates: [
    {
      id: "candidate-1",
      title: "[테스트] 보고서 제출",
      due_at: "2026-10-01T00:00:45.123Z",
      description: "보고서 준비",
      evidence_text: "2026년 10월 1일 오전 9시(한국 시간) 보고서 제출.",
      confidence: 0.82,
      selected: true,
    },
    {
      id: "candidate-2",
      title: "[테스트] 발표",
      due_at: null,
      description: null,
      evidence_text: "다음 발표 날짜는 미정입니다.",
      confidence: 0.3,
      selected: false,
    },
  ],
  warnings: ["[테스트] 발표 날짜를 원문에서 확정할 수 없습니다."],
  approved_deadline_ids: [],
  error_message: null,
  created_at: "2026-09-30T00:00:00Z",
  updated_at: "2026-09-30T00:00:00Z",
};
export async function mockAnalyses(
  page: Page,
  initial: Analysis[] = [readyAnalysis],
  source: Source = aiSource,
) {
  await mockApi(page, [source]);
  const state = {
    analyses: structuredClone(initial),
    deadlines: [] as Deadline[],
    starts: 0,
    reads: 0,
    finish: true,
    sourceChanged: false,
  };
  await page.route("**/test-api/api/sources/*/ai-analyses?**", (route) => {
    const offset = Number(
      new URL(route.request().url()).searchParams.get("offset") ?? 0,
    );
    return route.fulfill({ json: state.analyses.slice(offset, offset + 10) });
  });
  await page.route("**/test-api/api/sources/*/ai-analyses", (route) => {
    expect(route.request().postDataJSON()).toEqual({ allow_external_ai: true });
    state.starts++;
    const analysis = {
      ...structuredClone(readyAnalysis),
      status: "processing" as const,
      candidates: [],
    };
    state.analyses.unshift(analysis);
    return route.fulfill({ status: 202, json: analysis });
  });
  await page.route("**/test-api/api/ai-analyses/**", (route) => {
    const request = route.request();
    expect(request.headers().authorization).toBe(
      "Bearer test-only-placeholder",
    );
    const path = new URL(request.url()).pathname.replace(
      "/test-api/api/ai-analyses/",
      "",
    );
    const [id, action] = path.split("/");
    const analysis = state.analyses.find((item) => item.id === id);
    if (!analysis)
      return route.fulfill({
        status: 404,
        json: { detail: "Analysis not found" },
      });
    if (request.method() === "GET") {
      state.reads++;
      if (analysis.status === "processing" && state.finish)
        Object.assign(analysis, {
          status: "ready",
          candidates: structuredClone(readyAnalysis.candidates),
        });
      return route.fulfill({ json: analysis });
    }
    const body = request.postDataJSON();
    if (action === "approve" && analysis.status === "approved")
      return route.fulfill({ json: analysis });
    if (body.revision !== analysis.revision)
      return route.fulfill({
        status: 409,
        json: { detail: "Review changed; reload before retrying" },
      });
    if (action === "approve" && state.sourceChanged)
      return route.fulfill({
        status: 409,
        json: { detail: "Source changed; extract and analyze it again" },
      });
    if (request.method() === "PATCH") {
      expect(body.candidates).toHaveLength(analysis.candidates.length);
      body.candidates.forEach((item: CandidateEdit) =>
        expect(Object.keys(item).sort()).toEqual([
          "description",
          "due_at",
          "id",
          "selected",
          "title",
        ]),
      );
      analysis.candidates = body.candidates.map((item: CandidateEdit) => ({
        ...analysis.candidates.find((saved) => saved.id === item.id),
        ...item,
      }));
      analysis.revision++;
    }
    if (action === "approve") {
      analysis.status = "approved";
      const selected = analysis.candidates.filter((item) => item.selected);
      for (const candidate of selected) {
        const deadline = {
          id: `approved-${state.deadlines.length + 1}`,
          source_id: aiSource.id,
          title: candidate.title,
          due_at: candidate.due_at!,
          description: candidate.description,
          confidence: candidate.confidence,
          evidence_text: candidate.evidence_text,
          is_confirmed: true,
          deadline_type: null,
          created_at: analysis.created_at,
          updated_at: analysis.updated_at,
        };
        state.deadlines.push(deadline);
        analysis.approved_deadline_ids.push(deadline.id);
      }
    }
    if (action === "reject") analysis.status = "rejected";
    return route.fulfill({ json: analysis });
  });
  await page.route("**/test-api/api/deadlines/**", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1);
    const deadline = state.deadlines.find((item) => item.id === id);
    return deadline ? route.fulfill({ json: deadline }) : route.fallback();
  });
  await page.route("**/test-api/api/deadlines?**", (route) =>
    route.fulfill({ json: state.deadlines }),
  );
  return state;
}
