import type { Category } from "@/components/category-badge";
import type { GoogleReminderSettings } from "./google-reminders";
import type { Recurrence } from "@/features/tasks/recurrence-settings";
export type ScheduleType = "fixed" | "flexible";
export interface TaskInput {
  category?: Category | null;
  reset_occurrences?: boolean;
  recurrence?: Recurrence | null;
  google_reminders?: GoogleReminderSettings | null;
  deadline_id: string | null;
  title: string;
  description: string | null;
  estimated_minutes: number | null;
  priority: number;
  schedule_type: ScheduleType;
  earliest_start: string | null;
  latest_end: string | null;
  is_completed: boolean;
}
export interface Task extends TaskInput {
  category?: Category | null;
  placement?: { start_at: string; end_at: string; block_count: number } | null;
  placement_blocks?: { id: string; start_at: string; end_at: string }[];
  series_id?: string | null;
  original_start?: string | null;
  exception_count?: number;
  id: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface TaskFilters {
  dashboard?: boolean;
  category?: Category | null;
  deadline_id?: string;
  is_completed?: boolean;
  schedule_type?: ScheduleType;
  offset?: number;
}
