import { api, ApiError } from "@/lib/api/client";
import type { Deadline, DeadlineInput } from "@/types/api";
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  try {
    return await api<T>(path, options);
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 404)
        throw new ApiError(
          "마감일을 찾을 수 없습니다. 삭제되었거나 접근할 수 없는 마감일입니다.",
          404,
        );
      if (error.status === 422)
        throw new ApiError(
          "제목·공식 마감일·여유시간을 확인해 주세요. 여유시간은 1~2,147,483,647분의 정수여야 하며, 계산된 안전 마감일이 지원되는 날짜 범위 안에 있어야 합니다.",
          422,
        );
    }
    throw error;
  }
}
export const deadlinesApi = {
  list: (offset = 0) =>
    request<Deadline[]>(`/api/deadlines?limit=50&offset=${offset}`),
  get: (id: string) =>
    request<Deadline>(`/api/deadlines/${encodeURIComponent(id)}`),
  create: (payload: DeadlineInput) =>
    request<Deadline>("/api/deadlines", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  update: (id: string, payload: DeadlineInput) =>
    request<Deadline>(`/api/deadlines/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  remove: (id: string) =>
    request<void>(`/api/deadlines/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
};
