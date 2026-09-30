import { api } from "@/lib/api/client";
import type { Analysis, CandidateEdit } from "@/types/analysis";
const path = (id: string) => `/api/ai-analyses/${encodeURIComponent(id)}`;
export const analysesApi = {
  list: (sourceId: string, offset = 0, signal?: AbortSignal) =>
    api<Analysis[]>(
      `/api/sources/${encodeURIComponent(sourceId)}/ai-analyses?limit=10&offset=${offset}`,
      { signal },
    ),
  start: (sourceId: string, signal?: AbortSignal) =>
    api<Analysis>(`/api/sources/${encodeURIComponent(sourceId)}/ai-analyses`, {
      method: "POST",
      body: JSON.stringify({ allow_external_ai: true }),
      signal,
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
  autoRegister: (
    id: string,
    revision: number,
    title: string,
    signal?: AbortSignal,
  ) =>
    api<Analysis>(`${path(id)}/auto-register`, {
      method: "POST",
      body: JSON.stringify({
        revision,
        title,
        confirm_auto_registration: true,
      }),
      signal,
    }),
  reject: (id: string, revision: number) =>
    api<Analysis>(`${path(id)}/reject`, {
      method: "POST",
      body: JSON.stringify({ revision }),
    }),
};
