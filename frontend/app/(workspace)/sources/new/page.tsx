import { ScheduleRegistration } from "@/features/schedules/schedule-registration";
export default async function NewSourcePage({
  searchParams,
}: {
  searchParams: Promise<{
    new?: string | string[];
    mode?: string | string[];
    deadline_id?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const entry = typeof params.new === "string" ? params.new : "default";
  const mode = params.mode === "manual" ? "manual" : "source";
  const deadlineId =
    typeof params.deadline_id === "string" ? params.deadline_id : undefined;
  return (
    <ScheduleRegistration
      key={`${entry}:${mode}:${deadlineId ?? ""}`}
      initialMode={mode}
      deadlineId={deadlineId}
    />
  );
}
