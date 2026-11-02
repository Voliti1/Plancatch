import { api } from "@/lib/api/client";

export interface GoogleConnectionStatus {
  configured: boolean;
  connected: boolean;
  reconnect_required: boolean;
  pending: boolean;
  connected_at: string | null;
  refresh_expires_at: string | null;
}

const prefix = "/api/integrations/google-calendar";
export const googleCalendarApi = {
  status: () => api<GoogleConnectionStatus>(`${prefix}/status`),
  connect: () =>
    api<{ authorization_url: string; expires_in: number }>(
      `${prefix}/connect`,
      {
        method: "POST",
        credentials: "include",
      },
    ),
  disconnect: () =>
    api<{
      disconnected: boolean;
      google_revoked: boolean | null;
      manual_revoke_required: boolean;
    }>(`${prefix}/connection`, { method: "DELETE", credentials: "include" }),
};

export function checkedGoogleAuthorizationUrl(value: string): string {
  const url = new URL(value);
  if (
    url.origin !== "https://accounts.google.com" ||
    url.pathname !== "/o/oauth2/v2/auth" ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error(
      "안전한 Google 인증 주소를 확인하지 못했습니다. 다시 시도해 주세요.",
    );
  }
  return url.href;
}
