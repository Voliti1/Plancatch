// Display-only excerpt. The complete evidence is preserved in the API and review payloads.
export function briefEvidence(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const index = lines.findIndex((line) =>
    /마감|접수\s*(?:기간|종료)|제출\s*기한|validThrough/i.test(line),
  );
  const excerpt =
    index >= 0
      ? lines.slice(index, index + 2).join("\n")
      : lines.slice(0, 2).join("\n");
  const short = excerpt.slice(0, 240);
  return short + (short.length < text.trim().length ? " …" : "");
}
