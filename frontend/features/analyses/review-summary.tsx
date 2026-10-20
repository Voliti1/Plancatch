"use client";
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
  const { company } = useMemo(
    () => extractedSummary(analysis.input_text),
    [analysis.input_text],
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
              (source.loading ? "불러오는 중…" : "제목 정보 없음")}
          </dd>
        </div>
        <div>
          <dt>회사명</dt>
          <dd>{company}</dd>
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
      <p className="small muted">
        회사명과 마감일 근거는 분석 시점의 원문 기준입니다. 자료 제목과 원본
        링크는 현재 저장된 정보입니다.
      </p>
    </section>
  );
}
