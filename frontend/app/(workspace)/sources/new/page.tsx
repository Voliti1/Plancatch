import { ScheduleRegistration } from "@/features/schedules/schedule-registration";
import type { NaturalScheduleDraft } from "@/types/natural-schedule";
export default async function NewSourcePage({
  searchParams,
}: {
  searchParams: Promise<{
    new?: string | string[];
    mode?: string | string[];
    deadline_id?: string | string[];
    start?: string | string[];
    end?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const entry = typeof params.new === "string" ? params.new : "default";
  const mode =
    params.mode === "manual" || params.mode === "natural" ? "manual" : "source";
  const deadlineId =
    typeof params.deadline_id === "string" ? params.deadline_id : undefined;
  let manualDraft: NaturalScheduleDraft | undefined;
  if (
    mode === "manual" &&
    typeof params.start === "string" &&
    typeof params.end === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(params.start) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(params.end)
  ) {
    const start = Date.parse(params.start),
      end = Date.parse(params.end);
    if (
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      end > start &&
      end - start <= 86400000 &&
      start >= Date.parse("1000-01-01T00:00:00Z") &&
      end < Date.parse("9999-01-01T00:00:00Z")
    ) {
      manualDraft = {
        kind: "task",
        title: "",
        start_at: new Date(start).toISOString(),
        end_at: new Date(end).toISOString(),
        reference_at: new Date(start).toISOString(),
        timezone: "Asia/Seoul",
        notices: [],
      };
    }
  }
  const initialMode =
    params.mode === "natural" && !manualDraft ? "natural" : mode;
  return (
    <ScheduleRegistration
      key={`${entry}:${initialMode}:${deadlineId ?? ""}:${manualDraft?.start_at ?? ""}:${manualDraft?.end_at ?? ""}`}
      initialMode={initialMode}
      deadlineId={deadlineId}
      manualDraft={manualDraft}
    />
  );
}
