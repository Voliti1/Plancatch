import { SourceReview } from "@/features/sources/source-review";

export default async function SourceReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SourceReview key={id} id={id} />;
}
