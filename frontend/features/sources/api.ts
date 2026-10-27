import { api, ApiError } from "@/lib/api/client";
import type { Source, SourceInput, SourceUpdateInput } from "@/types/api";
export const sourcesApi = {
  uploadImage: (file: File, title?: string) => {
    const body = new FormData();
    body.append("file", file);
    if (title) body.append("title", title);
    return api<Source>("/api/sources/images", { method: "POST", body });
  },
  image: (id: string, signal?: AbortSignal) =>
    api<Blob>(
      `/api/sources/${encodeURIComponent(id)}/image`,
      { signal },
      true,
      "blob",
    ),
  list: (offset = 0, query = "") =>
    api<Source[]>(
      `/api/sources?limit=50&offset=${offset}&q=${encodeURIComponent(query)}`,
    ),
  create: (payload: SourceInput, signal?: AbortSignal) =>
    api<Source>("/api/sources", {
      method: "POST",
      body: JSON.stringify(payload),
      signal,
    }),
  get: (id: string, signal?: AbortSignal) =>
    api<Source>(`/api/sources/${encodeURIComponent(id)}`, { signal }),
  extract: (id: string, signal?: AbortSignal) =>
    api<Source>(`/api/sources/${encodeURIComponent(id)}/analyze`, {
      method: "POST",
      signal,
    }),
  update: (id: string, payload: SourceUpdateInput) =>
    api<Source>(`/api/sources/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  remove: async (id: string, signal?: AbortSignal) => {
    try {
      return await api<void>(`/api/sources/${encodeURIComponent(id)}`, {
        method: "DELETE",
        signal,
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        if (error.message === "source_has_deadlines")
          throw new ApiError(
            "마감일이 등록된 원본 자료는 삭제할 수 없습니다. 연결된 마감일을 먼저 삭제한 후 다시 시도해 주세요.",
            409,
          );
        if (error.message === "Source is currently processing")
          throw new ApiError(
            "원문을 처리 중인 자료입니다. 처리가 끝난 뒤 다시 삭제해 주세요.",
            409,
          );
      }
      throw error;
    }
  },
};
