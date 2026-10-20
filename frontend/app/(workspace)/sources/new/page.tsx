import { SourceForm } from "@/features/sources/source-form";
export default async function NewSourcePage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string | string[] }>;
}) {
  const entry = (await searchParams).new;
  return <SourceForm key={typeof entry === "string" ? entry : "default"} />;
}
