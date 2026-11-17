import { AutoSchedulePage } from "@/features/calendar/auto-schedule-page";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    plan?: string | string[];
    mode?: string;
    availability?: string;
  }>;
}) {
  const { plan, mode, availability } = await searchParams;
  const useSavedAvailability = availability !== "custom";
  return (
    <AutoSchedulePage
      key={`${typeof plan === "string" ? plan : mode === "replan" ? "replan" : "new"}:${useSavedAvailability ? "saved" : "custom"}`}
      initialReplace={mode === "replan"}
      initialSavedAvailability={useSavedAvailability}
      initialPlanId={typeof plan === "string" ? plan : undefined}
    />
  );
}
