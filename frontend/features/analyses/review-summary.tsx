"use client";
import Link from "next/link";
import { useCallback, useMemo } from "react";
import { useResource } from "@/lib/api/use-resource";
import { sourcesApi } from "@/features/sources/api";
import { extractedSummary } from "@/features/sources/extracted-summary";
import type { Analysis } from "@/types/analysis";

function publicPageUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

// Use the analysis snapshot for extracted facts, not a subsequently edited source.
// Loading current source metadata must never block review or approval.
export function ReviewSummary({ analysis }: { analysis: Analysis }) {
  const loader = useCallback(
    () => sourcesApi.get(analysis.source_id),
    [analysis.source_id],
  );
  const source = useResource(loader);
  const pdf = analysis.model.startsWith("pdf:");
  const candidateTitle =
    pdf && analysis.candidates.length === 1
      ? analysis.candidates[0].title
      : null;
  const companyTitle =
    analysis.revision === 1 && source.data && !source.data.title
      ? candidateTitle
      : null;
  const {
    title: documentTitle,
    company,
    companyFromCandidate,
  } = useMemo(
    () => extractedSummary(analysis.input_text, pdf, companyTitle ?? undefined),
    [analysis.input_text, pdf, companyTitle],
  );
  const url = publicPageUrl(source.data?.original_url);
  return (
    <section className="card analysis-summary" aria-label="자료 정보 요약">
      <h2>자료 정보</h2>
      <dl className="extracted-summary">
        <div>
          <dt>자료 제목</dt>
          <dd>
            {source.data?.title ||
              candidateTitle ||
              documentTitle ||
              (source.loading ? "불러오는 중…" : "제목 정보 없음")}
          </dd>
        </div>
        <div>
          <dt>회사명</dt>
          <dd>
            {company}
            {companyFromCandidate && (
              <span className="small muted"> (후보 제목에서 확인)</span>
            )}
          </dd>
        </div>
      </dl>
      {url && (
        <a
          className="source-detail-link"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          원본 페이지 열기 ↗
        </a>
      )}
      {source.error && (
        <p className="small muted">
          자료 정보를 불러오지 못했습니다. 마감일 검토는 계속할 수 있습니다.
        </p>
      )}
      {pdf &&
        analysis.status === "ready" &&
        company === "원문에서 회사명을 확인하지 못했습니다." && (
          <Link
            className="source-detail-link"
            href={`/sources/${encodeURIComponent(analysis.source_id)}/review?reanalyze=1`}
          >
            PDF 다시 분석하기 →
          </Link>
        )}
      <p className="small muted">
        마감일 근거는 분석 시점의 원문 기준입니다. 자료 제목은 저장한 제목이나
        분석에서 읽은 제목을 표시합니다.
      </p>
    </section>
  );
}
