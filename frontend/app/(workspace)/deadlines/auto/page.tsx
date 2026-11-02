import { AutoDeadlineForm } from "@/features/deadlines/auto-deadline-form";
import { Suspense } from "react";
import { Loading } from "@/components/feedback";

export default function AutoDeadlinePage() {
  return (
    <Suspense fallback={<Loading />}>
      <AutoDeadlineForm />
    </Suspense>
  );
}
