import { api } from "@/lib/api/client";
import type { Deadline } from "@/types/api";
// Fetch each page so linking a task is not limited to the first 50 deadlines.
export async function loadDeadlineOptions(): Promise<Deadline[]> {
  const deadlines: Deadline[] = [];
  let offset = 0;
  while (true) {
    const page = await api<Deadline[]>(
      `/api/deadlines?limit=100&offset=${offset}`,
    );
    deadlines.push(...page);
    if (page.length < 100) return deadlines;
    offset += 100;
  }
}
