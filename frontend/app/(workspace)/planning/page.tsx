import { AutoSchedulePage } from "@/features/calendar/auto-schedule-page";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string | string[] }>;
}) {
  const { plan } = await searchParams;
  return (
    <AutoSchedulePage
      key={typeof plan === "string" ? plan : "new"}
      initialPlanId={typeof plan === "string" ? plan : undefined}
    />
  );
}
