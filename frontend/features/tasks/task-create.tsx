"use client";
import { useRouter } from "next/navigation";
import { PageHeading } from "@/components/page-heading";
import { TaskForm } from "./task-form";
import { tasksApi } from "./api";
export function TaskCreate({ deadlineId }: { deadlineId?: string }) {
  const router = useRouter();
  return (
    <>
      <PageHeading
        eyebrow="NEW TASK"
        title="작업 등록"
        description="마감을 준비할 일을 작은 작업으로 나누어 보세요."
      />
      <section className="card form-card">
        <TaskForm
          deadlineId={deadlineId}
          onCancel={() =>
            router.push(
              deadlineId
                ? `/deadlines/${encodeURIComponent(deadlineId)}`
                : "/tasks",
            )
          }
          onSave={async (payload) => {
            const task = await tasksApi.create(payload);
            router.push(`/tasks/${encodeURIComponent(task.id)}`);
          }}
        />
      </section>
    </>
  );
}
