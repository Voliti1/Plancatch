import { TaskCreate } from "@/features/tasks/task-create";
export default async function NewTaskPage({
  searchParams,
}: {
  searchParams: Promise<{ deadline_id?: string | string[] }>;
}) {
  const { deadline_id } = await searchParams;
  const deadlineId = typeof deadline_id === "string" ? deadline_id : undefined;
  return <TaskCreate key={deadlineId ?? "unlinked"} deadlineId={deadlineId} />;
}
