import { ScheduleRegistration } from "@/features/schedules/schedule-registration";
export default async function NewSourcePage({
  searchParams,
}: {
  searchParams: Promise<{
    new?: string | string[];
    mode?: string | string[];
    deadline_id?: string | string[];
    preview?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const entry = typeof params.new === "string" ? params.new : "default";
  const mode = params.mode === "manual" ? "manual" : "source";
  const manualPreview =
    process.env.NODE_ENV === "development" && params.preview === "calendar";
  const deadlineId =
    typeof params.deadline_id === "string" ? params.deadline_id : undefined;
  return (
    <ScheduleRegistration
      key={`${entry}:${mode}:${deadlineId ?? ""}:${manualPreview}`}
      initialMode={mode}
      deadlineId={deadlineId}
      manualPreview={manualPreview}
    />
  );
}
