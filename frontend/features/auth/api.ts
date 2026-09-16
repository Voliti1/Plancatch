import { api } from "@/lib/api/client";
import type { User, TokenResponse } from "@/types/api";
export const authApi = {
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
  login: (email: string, password: string) =>
    api<TokenResponse>(
      "/api/auth/login",
      { method: "POST", body: JSON.stringify({ email, password }) },
      false,
    ),
  me: () => api<User>("/api/auth/me"),
};
