import { SESSION_EXPIRED, tokenStore } from "@/lib/auth/token";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "요청을 처리하지 못했습니다. 다시 시도해 주세요.";
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
  authenticated = true,
): Promise<T> {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL?.trim().replace(/\/$/, "");
  if (!base)
    throw new ApiError(
      "API 주소가 설정되지 않았습니다. NEXT_PUBLIC_API_BASE_URL 설정을 확인해 주세요.",
      0,
    );
  const headers = new Headers(options.headers);
  if (options.body) headers.set("Content-Type", "application/json");
  const token = authenticated ? tokenStore.get() : null;
  if (authenticated && !token) throw new ApiError("로그인이 필요합니다.", 401);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...options,
      headers,
      cache: "no-store",
      signal: options.signal ?? AbortSignal.timeout(15000),
    });
  } catch {
    throw new ApiError(
      "서버에 연결하지 못했습니다. 네트워크와 API 주소를 확인하고 다시 시도해 주세요.",
      0,
    );
  }
  if (!response.ok) {
    if (
      response.status === 401 &&
      authenticated &&
      tokenStore.get() === token
    ) {
      tokenStore.clear();
      window.dispatchEvent(new Event(SESSION_EXPIRED));
    }
    const body: { detail?: unknown } = await response.json().catch(() => ({}));
    const detail =
      typeof body.detail === "string"
        ? body.detail
        : Array.isArray(body.detail)
          ? body.detail
              .map((item: { msg?: string }) => item.msg ?? "입력값 오류")
              .join(" / ")
          : "요청을 처리하지 못했습니다.";
    throw new ApiError(
      response.status === 401
        ? "이메일·비밀번호 또는 로그인 세션을 확인해 주세요."
        : detail,
      response.status,
    );
  }
  return response.status === 204
    ? (undefined as T)
    : (response.json() as Promise<T>);
}
