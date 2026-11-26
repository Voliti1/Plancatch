import { ApiError, errorMessage } from "@/lib/api/client";

const messages: Record<string, string> = {
  processing_interrupted:
    "서버 작업이 중단되었어요. 저장한 자료는 유지돼요. 다시 추출하거나 분석을 다시 시작해 주세요.",
  html_too_complex:
    "페이지 구조를 읽기 어려워요. 필요한 내용을 텍스트나 캡처로 등록해 주세요.",
  invalid_or_unreachable_url:
    "접근 가능한 로그인 없이 볼 수 있는 링크인지 확인해 주세요. 주소를 확인하거나 텍스트로 등록해 주세요.",
  fetch_timeout:
    "연결한 사이트의 응답 대기 시간이 초과되었어요. 잠시 후 다시 시도해 주세요.",
  fetch_failed:
    "연결한 사이트에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
  requires_login:
    "로그인이 필요한 페이지예요. 로그인 없이 볼 수 있는 링크를 사용하거나 내용을 직접 텍스트로 등록해 주세요.",
  access_denied:
    "사이트에서 접근을 차단했어요. 접근 가능한 로그인 없이 볼 수 있는 링크이나 텍스트 자료를 사용해 주세요.",
  robots_disallowed:
    "사이트의 수집 정책에 따라 자료 내용을 가져올 수 없어요. 허용된 자료를 텍스트로 등록해 주세요.",
  robots_unavailable:
    "사이트의 수집 정책을 확인할 수 없어 추출을 중단했어요. 잠시 후 다시 시도해 주세요.",
  empty_content_or_rendering_required:
    "페이지 내용을 읽을 수 없어요. 필요한 글을 복사해 글 내용으로 등록해 주세요.",
  empty_content: "자료에 읽을 수 있는 본문이 없어요.",
  text_too_large:
    "자료 내용이 추출 가능한 크기를 초과했어요. 자료를 나누어 등록해 주세요.",
  response_too_large:
    "페이지 크기가 추출 가능한 한도를 초과했어요. 필요한 내용을 텍스트로 등록해 주세요.",
  rate_limited: "사이트의 요청 한도에 도달했어요. 잠시 후 다시 시도해 주세요.",
  unsupported_content_type:
    "이 링크에서는 내용을 읽을 수 없어요. PDF·이미지는 파일로 추가하고, 필요한 글은 글 내용으로 등록해 주세요.",
  unsupported_source_type: "이 자료 유형의 추출은 아직 지원하지 않아요.",
  unsupported_encoding:
    "페이지의 문자 인코딩을 읽을 수 없어요. 내용을 텍스트로 등록해 주세요.",
  unsafe_url:
    "보안 정책상 접근할 수 없는 URL이에요. 공개 웹페이지 주소를 확인해 주세요.",
  invalid_url: "공개 HTTP 또는 HTTPS URL인지 확인해 주세요.",
  invalid_redirect:
    "페이지의 이동 주소를 확인할 수 없어요. 최종 로그인 없이 볼 수 있는 링크를 사용해 주세요.",
  too_many_redirects:
    "페이지 이동이 너무 많아요. 최종 로그인 없이 볼 수 있는 링크를 사용해 주세요.",
  http_error:
    "사이트에서 정상 응답을 받지 못했어요. 주소를 확인하거나 잠시 후 다시 시도해 주세요.",
  network_error:
    "연결한 사이트에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
  extraction_failed:
    "내용 불러오기에 실패했어요. 자료를 확인한 뒤 다시 시도해 주세요.",
  pdf_text_unavailable:
    "PDF를 읽지 못했어요. 암호가 걸려 있거나 페이지가 많은 파일은 나누거나 다시 저장해 주세요.",
  ai_not_configured:
    "지금은 AI 분석을 사용할 수 없어요. 잠시 후 다시 시도하거나 관리자에게 문의해 주세요.",
  ai_model_not_configured:
    "지금은 AI 분석을 사용할 수 없어요. 관리자에게 문의해 주세요.",
  ai_rate_limited: "AI 요청 한도에 도달했어요. 잠시 후 다시 분석해 주세요.",
  ai_auth_error: "AI 분석에 연결할 수 없어요. 관리자에게 문의해 주세요.",
  ai_timeout:
    "AI 응답 대기 시간이 초과되었어요. 자료에서 다시 분석을 요청할 수 있어요.",
  ai_network_error:
    "AI 서비스에 연결하지 못했어요. 잠시 후 다시 분석해 주세요.",
  ai_invalid_result:
    "AI 결과를 검증하지 못했어요. 자료 내용을 확인한 뒤 다시 분석해 주세요.",
  ai_evidence_not_in_source:
    "AI가 제시한 근거를 자료 내용에서 확인하지 못해 결과를 저장하지 않았어요.",
  ai_incomplete_result:
    "AI 응답이 끝까지 생성되지 않았어요. 다시 분석해 주세요.",
  ai_response_too_large:
    "AI 응답이 허용 크기를 초과했어요. 자료를 나누어 분석해 주세요.",
  ai_provider_error:
    "AI 서비스에서 분석을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.",
  ai_processing_failed: "AI 분석에 실패했어요. 잠시 후 다시 분석해 주세요.",
  image_correction_unchanged: "이미지에서 읽은 글을 먼저 수정해 주세요.",
  image_correction_consent_required:
    "교정한 글을 분석하려면 외부 AI 전송에 동의해 주세요.",
  image_correction_requires_image: "이미지에서 읽은 글만 교정할 수 있어요.",
  ai_input_invalid:
    "분석 자료 내용을 사용할 수 없거나 자료가 변경됐어요. 자료 내용 상태를 확인한 뒤 다시 분석해 주세요.",
};

export function processingError(code: string): string {
  return (
    messages[code] ??
    "처리하지 못했어요. 자료를 확인하고 잠시 후 다시 시도해 주세요."
  );
}

export function analysisError(error: unknown): string {
  if (!(error instanceof ApiError)) return errorMessage(error);
  if (messages[error.message]) return messages[error.message];
  if (error.status === 404)
    return "자료 또는 분석을 찾을 수 없어요. 삭제되었거나 접근할 수 없어요.";
  if (error.status === 409) {
    if (error.message.includes("Source changed"))
      return "분석 이후 자료 내용이 변경되어 승인할 수 없어요. 자료에서 내용을 다시 불러온 뒤 마감일을 찾아 주세요.";
    if (error.message.includes("Review changed"))
      return "다른 검토 내용이 저장되어 버전이 바뀌었어요. 현재 입력을 확인한 뒤 최신 결과를 불러와 주세요.";
    if (error.message.includes("Extract source"))
      return "내용 불러오기가 완료되어야 AI 분석을 시작할 수 있어요. 자료 상태를 다시 확인해 주세요.";
    return "이미 처리 중이거나 검토 가능한 상태가 아니에요. 최신 상태를 확인해 주세요.";
  }
  if (error.status === 429)
    return "현재 처리 용량 또는 요청 한도에 도달했어요. 잠시 후 다시 시도해 주세요.";
  if (error.status === 503)
    return "지금은 AI 분석을 사용할 수 없어요. 잠시 후 다시 시도하거나 관리자에게 문의해 주세요.";
  if (error.status === 422)
    return "입력값을 확인해 주세요. 선택한 찾은 마감일에는 제목과 확정된 마감일이 필요해요.";
  return errorMessage(error);
}
