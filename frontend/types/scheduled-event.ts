export type EditableEventStatus = "recommended" | "approved" | "cancelled";
export interface ScheduledEventInput {
  task_id: string;
  start_at: string;
  end_at: string;
  status: EditableEventStatus;
}
export interface ScheduledEvent extends Omit<ScheduledEventInput, "status"> {
  id: string;
  task_title?: string | null;
  status: EditableEventStatus | "synced";
  is_user_approved: boolean;
  google_calendar_id: string | null;
  google_event_id: string | null;
  sync_error: string | null;
  created_at: string;
  updated_at: string;
}
export type ScheduledEventUpdate = Partial<
  Omit<ScheduledEventInput, "task_id">
>;
