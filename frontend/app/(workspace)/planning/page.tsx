import { AutoSchedulePage } from "@/features/calendar/auto-schedule-page";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string | string[]; mode?: string }>;
}) {
  const { plan, mode } = await searchParams;
  return (
    <AutoSchedulePage
      key={
        typeof plan === "string" ? plan : mode === "replan" ? "replan" : "new"
      }
      initialReplace={mode === "replan"}
      initialPlanId={typeof plan === "string" ? plan : undefined}
    />
  );
}
