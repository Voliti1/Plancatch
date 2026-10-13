import type { AnalysisStatus } from "@/types/analysis";
export const isHtmlAnalysis = (model: string | undefined) =>
  model === "html:saramin:v1";
export function analysisStatusLabel(
  status: AnalysisStatus,
  model?: string,
): string {
  if (isHtmlAnalysis(model) && status === "processing") return "HTML 확인 중";
  if (isHtmlAnalysis(model) && status === "failed") return "HTML 확인 실패";
  return (
    {
      processing: "AI 분석 중",
      ready: "검토 대기",
      failed: "AI 분석 실패",
      approved: "승인 완료",
      rejected: "전체 거부",
    }[status] ?? "상태 확인 필요"
  );
}
