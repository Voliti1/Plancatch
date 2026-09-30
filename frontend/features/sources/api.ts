import { api } from "@/lib/api/client";
import type { Source, SourceInput, SourceUpdateInput } from "@/types/api";
export const sourcesApi = {
  list: (offset = 0) => api<Source[]>(`/api/sources?limit=50&offset=${offset}`),
  create: (payload: SourceInput) =>
    api<Source>("/api/sources", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  get: (id: string, signal?: AbortSignal) =>
    api<Source>(`/api/sources/${encodeURIComponent(id)}`, { signal }),
  extract: (id: string) =>
    api<Source>(`/api/sources/${encodeURIComponent(id)}/analyze`, {
      method: "POST",
    }),
  update: (id: string, payload: SourceUpdateInput) =>
    api<Source>(`/api/sources/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  remove: (id: string) =>
    api<void>(`/api/sources/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
