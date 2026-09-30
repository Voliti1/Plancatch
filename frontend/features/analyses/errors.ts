import { ApiError, errorMessage } from "@/lib/api/client";

const messages: Record<string, string> = {
  invalid_or_unreachable_url:
    "접근 가능한 공개 URL인지 확인해 주세요. 주소를 확인하거나 텍스트로 등록해 주세요.",
  fetch_timeout:
    "원본 사이트의 응답 대기 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.",
  fetch_failed:
    "원본 사이트에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  requires_login:
    "로그인이 필요한 페이지입니다. 공개 URL을 사용하거나 내용을 직접 텍스트로 등록해 주세요.",
  access_denied:
    "사이트에서 접근을 차단했습니다. 접근 가능한 공개 URL이나 텍스트 자료를 사용해 주세요.",
  robots_disallowed:
    "사이트의 수집 정책에 따라 원문을 가져올 수 없습니다. 허용된 자료를 텍스트로 등록해 주세요.",
  robots_unavailable:
    "사이트의 수집 정책을 확인할 수 없어 추출을 중단했습니다. 잠시 후 다시 시도해 주세요.",
  empty_content_or_rendering_required:
    "읽을 수 있는 본문이 없거나 JavaScript 실행이 필요한 페이지입니다. 내용을 직접 텍스트로 등록해 주세요.",
  empty_content: "자료에 읽을 수 있는 본문이 없습니다.",
  text_too_large:
    "원문이 추출 가능한 크기를 초과했습니다. 자료를 나누어 등록해 주세요.",
  response_too_large:
    "페이지 크기가 추출 가능한 한도를 초과했습니다. 필요한 내용을 텍스트로 등록해 주세요.",
  rate_limited:
    "사이트의 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.",
  unsupported_content_type:
    "현재 HTML과 텍스트만 추출할 수 있습니다. PDF·이미지 추출은 아직 지원하지 않습니다.",
  unsupported_source_type: "이 자료 유형의 추출은 아직 지원하지 않습니다.",
  unsupported_encoding:
    "페이지의 문자 인코딩을 읽을 수 없습니다. 내용을 텍스트로 등록해 주세요.",
  unsafe_url:
    "보안 정책상 접근할 수 없는 URL입니다. 공개 웹페이지 주소를 확인해 주세요.",
  invalid_url: "공개 HTTP 또는 HTTPS URL인지 확인해 주세요.",
  invalid_redirect:
    "페이지의 이동 주소를 확인할 수 없습니다. 최종 공개 URL을 사용해 주세요.",
  too_many_redirects:
    "페이지 이동이 너무 많습니다. 최종 공개 URL을 사용해 주세요.",
  http_error:
    "사이트에서 정상 응답을 받지 못했습니다. 주소를 확인하거나 잠시 후 다시 시도해 주세요.",
  network_error:
    "원본 사이트에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  extraction_failed:
    "원문 추출에 실패했습니다. 자료를 확인한 뒤 다시 시도해 주세요.",
  ai_not_configured:
    "서버의 AI 설정이 준비되지 않아 분석할 수 없습니다. 관리자에게 확인해 주세요.",
  ai_model_not_configured:
    "서버의 AI 모델 설정이 준비되지 않아 분석할 수 없습니다.",
  ai_rate_limited: "AI 요청 한도에 도달했습니다. 잠시 후 다시 분석해 주세요.",
  ai_auth_error:
    "서버에서 AI 서비스를 사용할 수 없습니다. 관리자에게 확인해 주세요.",
  ai_timeout:
    "AI 응답 대기 시간이 초과되었습니다. 자료에서 다시 분석을 요청할 수 있습니다.",
  ai_network_error:
    "AI 서비스에 연결하지 못했습니다. 잠시 후 다시 분석해 주세요.",
  ai_invalid_result:
    "AI 결과를 검증하지 못했습니다. 원문을 확인한 뒤 다시 분석해 주세요.",
  ai_evidence_not_in_source:
    "AI가 제시한 근거를 원문에서 확인하지 못해 결과를 저장하지 않았습니다.",
  ai_incomplete_result:
    "AI 응답이 끝까지 생성되지 않았습니다. 다시 분석해 주세요.",
  ai_response_too_large:
    "AI 응답이 허용 크기를 초과했습니다. 자료를 나누어 분석해 주세요.",
  ai_provider_error:
    "AI 서비스에서 분석을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  ai_processing_failed: "AI 분석에 실패했습니다. 잠시 후 다시 분석해 주세요.",
};

export function processingError(code: string): string {
  return (
    messages[code] ??
    "처리하지 못했습니다. 자료를 확인하고 잠시 후 다시 시도해 주세요."
  );
}

export function analysisError(error: unknown): string {
  if (!(error instanceof ApiError)) return errorMessage(error);
  if (messages[error.message]) return messages[error.message];
  if (error.status === 404)
    return "자료 또는 분석을 찾을 수 없습니다. 삭제되었거나 접근할 수 없습니다.";
  if (error.status === 409) {
    if (error.message.includes("Source changed"))
      return "분석 이후 원문이 변경되어 승인할 수 없습니다. 자료에서 원문을 다시 추출하고 분석해 주세요.";
    if (error.message.includes("Review changed"))
      return "다른 검토 내용이 저장되어 버전이 바뀌었습니다. 현재 입력을 확인한 뒤 최신 결과를 불러와 주세요.";
    if (error.message.includes("Extract source"))
      return "원문 추출이 완료되어야 AI 분석을 시작할 수 있습니다. 자료 상태를 다시 확인해 주세요.";
    return "이미 처리 중이거나 검토 가능한 상태가 아닙니다. 최신 상태를 확인해 주세요.";
  }
  if (error.status === 429)
    return "현재 처리 용량 또는 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.";
  if (error.status === 503)
    return "서버의 AI 설정이 준비되지 않아 분석할 수 없습니다. 관리자에게 확인해 주세요.";
  if (error.status === 422)
    return "입력값을 확인해 주세요. 선택한 후보에는 제목과 확정된 마감일이 필요합니다.";
  return errorMessage(error);
}
