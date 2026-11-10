export type NaturalScheduleDraft = {
  recurrence?: import("@/features/tasks/recurrence-settings").Recurrence | null;
  kind: "task" | "deadline";
  title: string;
  start_at: string | null;
  end_at: string | null;
  reference_at: string;
  timezone: "Asia/Seoul";
  notices: string[];
};
