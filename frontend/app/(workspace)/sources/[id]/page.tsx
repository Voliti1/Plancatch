import { SourceDetail } from "@/features/sources/source-detail";
export default async function SourcePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SourceDetail key={id} id={id} />;
}
