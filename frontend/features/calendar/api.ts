import { api, ApiError } from "@/lib/api/client";
import type {
  ScheduledEvent,
  ScheduledEventInput,
  ScheduledEventUpdate,
} from "@/types/scheduled-event";

type EventFilters = {
  task_id?: string;
  start_from?: string;
  end_before?: string;
};
function explain(error: unknown): never {
  if (error instanceof ApiError && error.status === 404)
    throw new ApiError(
      "일정 배치를 찾을 수 없습니다. 삭제되었거나 접근할 수 없거나 서버 API가 아직 제공되지 않을 수 있습니다.",
      404,
    );
  if (error instanceof ApiError && error.status === 409)
    throw new ApiError(
      "동기화된 일정은 이 화면에서 변경할 수 없습니다. 배치 내역을 다시 확인해 주세요.",
      409,
    );
  throw error;
}
export const eventsApi = {
  async list(filters: EventFilters, offset = 0): Promise<ScheduledEvent[]> {
    const query = new URLSearchParams({ limit: "100", offset: String(offset) });
    for (const [key, value] of Object.entries(filters))
      if (value) query.set(key, value);
    try {
      return await api<ScheduledEvent[]>(`/api/scheduled-events?${query}`);
    } catch (error) {
      explain(error);
    }
  },
  async all(
    filters: EventFilters,
  ): Promise<{ events: ScheduledEvent[]; hasMore: boolean }> {
    const events: ScheduledEvent[] = [];
    for (let page = 0; page < 20; page++) {
      const batch = await eventsApi.list(filters, page * 100);
      events.push(...batch);
      if (batch.length < 100) return { events, hasMore: false };
    }
    return { events, hasMore: true };
  },
  async create(input: ScheduledEventInput): Promise<ScheduledEvent> {
    try {
      return await api<ScheduledEvent>("/api/scheduled-events", {
        method: "POST",
        body: JSON.stringify(input),
      });
    } catch (error) {
      explain(error);
    }
  },
  async update(
    id: string,
    input: ScheduledEventUpdate,
  ): Promise<ScheduledEvent> {
    try {
      return await api<ScheduledEvent>(
        `/api/scheduled-events/${encodeURIComponent(id)}`,
        { method: "PATCH", body: JSON.stringify(input) },
      );
    } catch (error) {
      explain(error);
    }
  },
  async remove(id: string) {
    try {
      await api<void>(`/api/scheduled-events/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    } catch (error) {
      explain(error);
    }
  },
};
