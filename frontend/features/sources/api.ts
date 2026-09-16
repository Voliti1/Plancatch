import { api } from "@/lib/api/client";
import type { Source, SourceInput } from "@/types/api";
export const sourcesApi = {
  list: (offset = 0) => api<Source[]>(`/api/sources?limit=50&offset=${offset}`),
  create: (payload: SourceInput) =>
    api<Source>("/api/sources", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};
