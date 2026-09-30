export type ScheduleType = "fixed" | "flexible";
export interface TaskInput {
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
  id: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface TaskFilters {
  deadline_id?: string;
  is_completed?: boolean;
  schedule_type?: ScheduleType;
  offset?: number;
}
