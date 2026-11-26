import { api } from "@/lib/api/client";
import type { User, TokenResponse } from "@/types/api";
export const authApi = {
  updateProfile: (payload: { display_name: string | null }) =>
    api<User>("/api/auth/me", {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  signup: (payload: {
    email: string;
    password: string;
    display_name?: string;
  }) =>
    api<User>(
      "/api/auth/signup",
      { method: "POST", body: JSON.stringify(payload) },
      false,
    ),
  requestPasswordRecovery: (email: string) =>
    api<{ accepted: boolean }>(
      "/api/auth/password-recovery",
      { method: "POST", body: JSON.stringify({ email }) },
      false,
    ),
  login: (email: string, password: string) =>
    api<TokenResponse>(
      "/api/auth/login",
      { method: "POST", body: JSON.stringify({ email, password }) },
      false,
    ),
  googleChallenge: (signal: AbortSignal) =>
    api<{ client_id: string | null; nonce: string | null }>(
      "/api/auth/google/challenge",
      { method: "POST", credentials: "include", signal, timeoutMs: 10000 },
      false,
    ),
  googleLogin: (credential: string, current_password?: string) =>
    api<TokenResponse>(
      "/api/auth/google",
      {
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ credential, current_password }),
      },
      false,
    ),
  me: () => api<User>("/api/auth/me"),
  saveTimeZone: (time_zone: string) =>
    api<User>("/api/auth/time-zone", {
      method: "PATCH",
      body: JSON.stringify({ time_zone }),
    }),
  changePassword: (current_password: string, new_password: string) =>
    api<TokenResponse>("/api/auth/password", {
      method: "POST",
      body: JSON.stringify({ current_password, new_password }),
    }),
};
