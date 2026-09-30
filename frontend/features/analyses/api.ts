import { api } from "@/lib/api/client";
import type { Analysis, CandidateEdit } from "@/types/analysis";
const path = (id: string) => `/api/ai-analyses/${encodeURIComponent(id)}`;
export const analysesApi = {
  list: (sourceId: string, offset = 0) =>
    api<Analysis[]>(
      `/api/sources/${encodeURIComponent(sourceId)}/ai-analyses?limit=10&offset=${offset}`,
    ),
  start: (sourceId: string) =>
    api<Analysis>(`/api/sources/${encodeURIComponent(sourceId)}/ai-analyses`, {
      method: "POST",
      body: JSON.stringify({ allow_external_ai: true }),
    }),
  get: (id: string, signal?: AbortSignal) =>
    api<Analysis>(path(id), { signal }),
  review: (id: string, revision: number, candidates: CandidateEdit[]) =>
    api<Analysis>(path(id), {
      method: "PATCH",
      body: JSON.stringify({ revision, candidates }),
    }),
  approve: (id: string, revision: number) =>
    api<Analysis>(`${path(id)}/approve`, {
      method: "POST",
      body: JSON.stringify({ revision }),
    }),
  reject: (id: string, revision: number) =>
    api<Analysis>(`${path(id)}/reject`, {
      method: "POST",
      body: JSON.stringify({ revision }),
    }),
};
