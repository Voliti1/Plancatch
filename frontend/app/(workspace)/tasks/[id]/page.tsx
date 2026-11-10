import { TaskDetail } from "@/features/tasks/task-detail";
import { OccurrenceDetail } from "@/features/tasks/occurrence-detail";
export default async function TaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ occurrence?: string | string[] }>;
}) {
  const { id } = await params;
  const { occurrence } = await searchParams;
  if (typeof occurrence === "string")
    return (
      <OccurrenceDetail key={`${id}:${occurrence}`} id={id} at={occurrence} />
    );
  return <TaskDetail key={id} id={id} />;
}
