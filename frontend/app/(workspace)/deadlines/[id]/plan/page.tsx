import { TaskPlanPage } from "@/features/tasks/task-plan-page";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TaskPlanPage id={id} />;
}
