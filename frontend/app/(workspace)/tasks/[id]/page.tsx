import { TaskDetail } from "@/features/tasks/task-detail";
import { OccurrenceDetail } from "@/features/tasks/occurrence-detail";
export default async function TaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ occurrence?: string | string[]; edit?: string }>;
}) {
  const { id } = await params;
  const { occurrence, edit } = await searchParams;
  const startEditing = edit === "1";
  if (typeof occurrence === "string")
    return (
      <OccurrenceDetail
        key={`${id}:${occurrence}:${startEditing}`}
        id={id}
        at={occurrence}
        startEditing={startEditing}
      />
    );
  return (
    <TaskDetail
      key={`${id}:${startEditing}`}
      id={id}
      startEditing={startEditing}
    />
  );
}
