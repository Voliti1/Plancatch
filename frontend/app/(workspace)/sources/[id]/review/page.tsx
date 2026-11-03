import { SourceReview } from "@/features/sources/source-review";

export default async function SourceReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ reanalyze?: string }>;
}) {
  const [{ id }, { reanalyze }] = await Promise.all([params, searchParams]);
  return <SourceReview key={id} id={id} reanalyzePdf={reanalyze === "1"} />;
}
