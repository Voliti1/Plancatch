import { DeadlineDetail } from "@/features/deadlines/deadline-detail";
export default async function DeadlinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DeadlineDetail id={id} />;
}
