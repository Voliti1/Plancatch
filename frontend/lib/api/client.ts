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
function responseDetail(body: unknown): string {
  const fallback = "요청을 처리하지 못했습니다.";
  if (!body || typeof body !== "object" || !("detail" in body)) return fallback;
  const detail = body.detail;
  if (typeof detail === "string") return detail.trim() || fallback;
  if (!Array.isArray(detail)) return fallback;
  const messages = detail.slice(0, 10).flatMap((item: unknown) => {
    if (
      !item ||
      typeof item !== "object" ||
      !("msg" in item) ||
      typeof item.msg !== "string"
    )
      return [];
    return item.msg.trim() ? [item.msg.trim()] : [];
  });
  return messages.join(" / ") || fallback;
}
export async function api<T>(
  path: string,
  options: RequestInit & { timeoutMs?: number } = {},
  authenticated = true,
  responseType: "json" | "blob" = "json",
): Promise<T> {
  // A deployed frontend shares its origin with the reverse-proxied API.
  // Local development can still opt into a different API through .env.local.
  const base =
    process.env.NEXT_PUBLIC_API_BASE_URL?.trim().replace(/\/$/, "") ?? "";
  // A save can briefly wait for the same account's bounded calendar operation.
  const {
    timeoutMs = (options.method ?? "GET").toUpperCase() === "GET"
      ? 15000
      : 60000,
    ...requestOptions
  } = options;
  const headers = new Headers(requestOptions.headers);
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const token = authenticated ? tokenStore.get() : null;
  if (authenticated && !token) throw new ApiError("로그인이 필요합니다.", 401);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...requestOptions,
      headers,
      cache: "no-store",
      signal: requestOptions.signal
        ? AbortSignal.any([
            requestOptions.signal,
            AbortSignal.timeout(timeoutMs),
          ])
        : AbortSignal.timeout(timeoutMs),
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
    const detail = responseDetail(await response.json().catch(() => null));
    throw new ApiError(
      response.status === 401
        ? "이메일·비밀번호 또는 로그인 세션을 확인해 주세요."
        : detail,
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  try {
    return (await (responseType === "blob"
      ? response.blob()
      : response.json())) as T;
  } catch {
    // A successful write whose body was lost may already have committed. Keep
    // status 0 so existing uncertainty guards do not offer a blind resubmit.
    throw new ApiError(
      "서버 응답을 확인하지 못했습니다. 저장 여부를 확인한 뒤 다시 시도해 주세요.",
      0,
    );
  }
}
