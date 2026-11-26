import { api } from "@/lib/api/client";
import type { TokenResponse } from "@/types/api";

export type KakaoMode = "login" | "account" | "calendar";
type Calendar = { id: string; name: string };

export const kakaoModeKey = "plancatch.kakao.mode";

export const kakaoApi = {
  status: (mode: KakaoMode) =>
    api<{ configured: boolean; connected?: boolean }>(
      `/api/kakao/${mode}/status`,
      {},
      mode !== "login",
    ),
  start: (mode: KakaoMode) =>
    api<{ authorization_url: string }>(
      `/api/kakao/${mode}/start`,
      { method: "POST", credentials: "include" },
      mode !== "login",
    ),
  login: (code: string, state: string) =>
    api<TokenResponse>(
      "/api/kakao/login/complete",
      {
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ code, state }),
      },
      false,
    ),
  complete: (mode: Exclude<KakaoMode, "login">, code: string, state: string) =>
    api<{ connected: boolean; calendars?: Calendar[] }>(
      `/api/kakao/${mode}/complete`,
      {
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ code, state }),
      },
    ),
  calendars: () =>
    api<{ calendars: Calendar[] }>("/api/kakao/calendar/calendars", {
      method: "POST",
    }),
  disconnect: () => api("/api/kakao/calendar/connection", { method: "DELETE" }),
};

export async function beginKakao(mode: KakaoMode) {
  const response = await kakaoApi.start(mode);
  const url = new URL(response.authorization_url);
  if (
    url.origin !== "https://kauth.kakao.com" ||
    url.pathname !== "/oauth/authorize" ||
    url.username ||
    url.password
  )
    throw new Error("카카오 인증 주소를 확인하지 못했어요.");
  sessionStorage.setItem(kakaoModeKey, mode);
  window.location.assign(url.href);
}

export function kakaoMessage(error: unknown) {
  const messages: Record<string, string> = {
    kakao_unavailable: "카카오 연결을 준비 중이에요.",
    kakao_expired:
      "카카오 연결 요청이 만료됐어요. 처음부터 다시 시도해 주세요.",
    kakao_link_existing:
      "같은 이메일의 플랜캐치 계정이 있어요. 기존 방식으로 로그인한 뒤 설정에서 카카오 로그인 계정을 연결해 주세요.",
    kakao_verified_email_required:
      "카카오에서 인증된 이메일을 제공해야 가입할 수 있어요.",
    kakao_identity_in_use: "이 카카오 계정은 다른 연결에 사용 중이에요.",
    kakao_calendar_permission_required:
      "카카오 캘린더 권한을 확인하지 못했어요. 동의 화면에서 캘린더 접근을 허용했는지 확인해 주세요.",
    kakao_calendar_reconnect:
      "카카오 캘린더에 접근할 수 없어요. 계정을 다시 연결해 주세요.",
  };
  return (
    (error instanceof Error && messages[error.message]) ||
    "카카오 요청을 완료하지 못했어요. 다시 시도해 주세요."
  );
}
