import { api } from "@/lib/api/client";
import type { Deadline, DeadlineInput } from "@/types/api";
export const deadlinesApi = {
  list: (offset = 0) =>
    api<Deadline[]>(`/api/deadlines?limit=50&offset=${offset}`),
  get: (id: string) =>
    api<Deadline>(`/api/deadlines/${encodeURIComponent(id)}`),
  create: (payload: DeadlineInput) =>
    api<Deadline>("/api/deadlines", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  update: (id: string, payload: DeadlineInput) =>
    api<Deadline>(`/api/deadlines/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  remove: (id: string) =>
    api<void>(`/api/deadlines/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
