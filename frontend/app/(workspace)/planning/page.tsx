import { AutoSchedulePage } from "@/features/calendar/auto-schedule-page";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    plan?: string | string[];
    mode?: string;
    availability?: string;
    task?: string | string[];
    retry?: string | string[];
  }>;
}) {
  const { plan, mode, availability, task, retry } = await searchParams;
  const retryId = typeof retry === "string" ? retry : undefined;
  const taskId = typeof task === "string" ? task : undefined;
  const planId = retryId ?? (typeof plan === "string" ? plan : undefined);
  const useSavedAvailability = availability !== "custom";
  return (
    <AutoSchedulePage
      key={`${planId ?? ""}:${mode ?? ""}:${useSavedAvailability}:${taskId ?? ""}:${Boolean(retryId)}`}
      initialReplace={mode === "replan"}
      initialSavedAvailability={useSavedAvailability}
      initialPlanId={planId}
      initialTaskId={taskId}
      retryPlan={Boolean(retryId)}
    />
  );
}
