function recruitmentHeadingCompany(line: string) {
  const heading = line.replace(
    /^(?:20\d{2}(?:\s*년(?:도)?)?\s*)?(?:[상하]반기\s*)?/,
    "",
  );
  return heading.match(
    /^((?:[A-Z]{2,8}\s*)?[\p{L}][\p{L}\p{N}&.-]{1,29})\s+(?:신입(?:사원)?|경력(?:사원)?|인턴)\s+(?:공개\s*)?(?:채용|공채)(?:\s|$)/u,
  )?.[1];
}

export function extractedSummary(
  text: string,
  isPdf = false,
  candidateTitle?: string,
) {
  // Prefer the same-job HTML slot captured at extraction time. Body text can
  // contain unrelated company names from recommendations or advertising.
  const begin = "[URL 마감일 HTML 검토 데이터]";
  const end = "[URL 마감일 HTML 검토 끝]";
  let verifiedCompany: string | null | undefined;
  if (
    text.split(begin).length === 2 &&
    text.split(end).length === 2 &&
    text.trimEnd().endsWith(end)
  ) {
    const raw = text.split(begin)[1].split(end)[0].trim();
    if (raw.length <= 25000) {
      try {
        const data = JSON.parse(raw);
        if (
          data &&
          data.version === 1 &&
          typeof data.submitted_url === "string" &&
          typeof data.fetched_url === "string"
        ) {
          if (data.company_name === null) verifiedCompany = null;
          else if (
            typeof data.company_name === "string" &&
            data.company_name.trim().length > 0 &&
            data.company_name.length <= 200 &&
            !/[<>\u0000-\u001f]/.test(data.company_name)
          ) {
            verifiedCompany = data.company_name.trim();
          }
        }
      } catch {
        /* Historical plain-text extracts keep their labelled fallback. */
      }
    }
  }
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const openingLines = isPdf ? lines.slice(0, 8) : [];
  const titleIndex = openingLines.findIndex((line) =>
    /^(?:\[[^\]]{1,20}\]\s*)?20\d{2}(?:\s*년(?:도)?)?\s+.{0,150}(?:채용|모집|공모|공채)(?:\s|$)/.test(
      line,
    ),
  );
  const subtitle = openingLines[titleIndex + 1];
  const title =
    titleIndex < 0
      ? undefined
      : openingLines[titleIndex] +
        (subtitle && /^\([^)]{1,100}\)\s*공고$/.test(subtitle)
          ? ` ${subtitle}`
          : "");
  // PDFs often print the employer inside the recruitment heading.
  const pdfHeadingCompanies = openingLines.flatMap((line) => {
    const employer =
      line.match(
        /^([\p{L}][\p{L}\p{N}&.-]{1,39})\s+공고\s*제\s*20\d{2}\s*[-–—]/u,
      )?.[1] ||
      recruitmentHeadingCompany(line) ||
      line.match(
        /^([\p{L}][\p{L}\p{N}&.-]{1,29})(?:은|는)\s+[^.!?]{2,80}\s+자회사로서(?:\s|$)/u,
      )?.[1];
    return employer ? [employer] : [];
  });
  const companies: string[] = [];
  const deadlines: string[] = [];
  const corporateNames: string[] = [];
  const companyLabel =
    /^(?:회사명|기업명|업체명|채용 회사)(?:\s*[:：]\s*(.*)|\s+(.+))?$/;
  const deadlineLabel =
    /^(?:마감(?:일|\s*일시|\s*시간)|접수\s*(?:마감(?:일|\s*일시)?|종료(?:일)?|기한)|지원\s*마감(?:일)?|제출\s*기한|validThrough)(?:\s*(?:\(validThrough\)|원문))?(?:\s*[:：]\s*(.*)|\s+(.+))?$/i;
  const dateValue =
    /(?:\d{4}\s*(?:[.\-/]|년)\s*\d{1,2}|\d{1,2}\s*(?:[.\-/]|월)\s*\d{1,2}|채용\s*시\s*마감|상시\s*(?:채용|모집)|미정)/;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const company = line.match(companyLabel);
    if (company) {
      const value = company[1] || company[2] || lines[index + 1];
      if (
        value &&
        value.length <= 80 &&
        !deadlineLabel.test(value) &&
        !/^https?:/i.test(value)
      )
        companies.push(value);
    }
    // Standalone legal company names are a fallback, never the user-set title
    // or an arbitrary first line. Conflicting names remain unconfirmed.
    if (
      line.length <= 80 &&
      /^(?:(?:\(주\)|㈜|주식회사)\s*\S+|\S+\s*(?:\(주\)|㈜))$/.test(line) &&
      !/(?:모집|공고|마감|https?:|[<>])/.test(line)
    )
      corporateNames.push(line);
    // The generated ISO line is a service normalization, not a second printed
    // closing date. Keep the explicitly labelled original value in the summary.
    const deadline = line.startsWith("마감일 (정규화):")
      ? null
      : line.match(deadlineLabel);
    if (deadline) {
      const value = deadline[1] || deadline[2] || lines[index + 1];
      if (value && value.length <= 120 && dateValue.test(value))
        deadlines.push(value);
    }
  }
  const uniqueCompanies = [
    ...new Map(
      (companies.length
        ? companies
        : corporateNames.length
          ? corporateNames
          : pdfHeadingCompanies
      ).map((value) => [value.replace(/\(주\)|㈜|주식회사|\s/g, ""), value]),
    ).values(),
  ];
  const uniqueDeadlines = [
    ...new Map(
      deadlines.map((value) => [
        value
          .replace(/[.\/]/g, "-")
          .replace(/T(?=\d)/, " ")
          .replace(/\s+/g, " "),
        value,
      ]),
    ).values(),
  ];
  const candidateCompany =
    isPdf &&
    candidateTitle &&
    verifiedCompany === undefined &&
    !uniqueCompanies.length
      ? recruitmentHeadingCompany(candidateTitle)
      : undefined;
  return {
    title,
    company:
      verifiedCompany !== undefined
        ? verifiedCompany || "원문에서 회사명을 확인하지 못했습니다."
        : uniqueCompanies.length === 1
          ? uniqueCompanies[0]
          : uniqueCompanies.length
            ? "여러 회사명이 있어 원문 확인이 필요합니다."
            : candidateCompany || "원문에서 회사명을 확인하지 못했습니다.",
    companyFromCandidate: Boolean(candidateCompany),
    deadline:
      uniqueDeadlines.length === 1
        ? uniqueDeadlines[0]
        : uniqueDeadlines.length
          ? "여러 마감일이 있어 원문 확인이 필요합니다."
          : "원문에서 마감일을 확인하지 못했습니다.",
  };
}
