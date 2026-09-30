import { AnalysisDetail } from "@/features/analyses/analysis-detail";
export default async function AnalysisPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AnalysisDetail key={id} id={id} />;
}
