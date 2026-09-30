export function sourceTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    url: "URL 링크",
    text: "텍스트",
    pdf: "PDF",
    image: "이미지",
  };
  return labels[type] ?? "기타 자료";
}
export function processingStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: "처리 대기",
    processing: "처리 중",
    completed: "처리 완료",
    failed: "처리 실패",
  };
  return labels[status] ?? "상태 확인 필요";
}
