import { api, ApiError } from "@/lib/api/client";
import type { Task, TaskFilters, TaskInput } from "@/types/task";
export const tasksApi = {
  list: (filters: TaskFilters = {}) => {
    const query = new URLSearchParams({
      limit: "50",
      offset: String(filters.offset ?? 0),
    });
    if (filters.deadline_id) query.set("deadline_id", filters.deadline_id);
    if (filters.is_completed !== undefined)
      query.set("is_completed", String(filters.is_completed));
    if (filters.schedule_type)
      query.set("schedule_type", filters.schedule_type);
    return api<Task[]>(`/api/tasks?${query}`);
  },
  get: async (id: string) => {
    try {
      return await api<Task>(`/api/tasks/${encodeURIComponent(id)}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404)
        throw new ApiError(
          "작업을 찾을 수 없습니다. 삭제되었거나 접근할 수 없는 작업입니다.",
          404,
        );
      throw err;
    }
  },
  create: (payload: TaskInput) =>
    api<Task>("/api/tasks", { method: "POST", body: JSON.stringify(payload) }),
  update: (id: string, payload: Partial<TaskInput>) =>
    api<Task>(`/api/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  remove: async (id: string) => {
    try {
      await api<void>(`/api/tasks/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409)
        throw new ApiError(
          "연결된 캘린더 일정이 있어 삭제할 수 없습니다. 동기화 상태를 먼저 확인해 주세요.",
          409,
        );
      throw err;
    }
  },
};
