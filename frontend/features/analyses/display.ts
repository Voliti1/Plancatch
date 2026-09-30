import type { AnalysisStatus } from "@/types/analysis";
export function analysisStatusLabel(status: AnalysisStatus): string {
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
