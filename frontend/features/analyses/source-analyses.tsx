"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useId, useRef, useState } from "react";
import { Empty, ErrorNotice, Loading } from "@/components/feedback";
import { useResource } from "@/lib/api/use-resource";
import { formatSeoul } from "@/lib/date/seoul";
import type { Source } from "@/types/api";
import { analysesApi } from "./api";
import { analysisError } from "./errors";
import { analysisStatusLabel } from "./display";

export function SourceAnalyses({
  source,
  disabled,
  onBusy,
}: {
  source: Source;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
}) {
  const [consentText, setConsentText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [hasProcessing, setHasProcessing] = useState(false);
  const pending = useRef(false);
  const router = useRouter();
  const consentId = useId();
  const textLength = Array.from(source.extracted_text ?? "").length;
  const extracted = source.processing_status === "extracted" && textLength > 0;
  const consent = extracted && consentText === source.extracted_text;
  const allowed = extracted && textLength <= 40000 && !hasProcessing;
  async function start() {
    if (pending.current || !consent || !allowed || disabled) return;
    pending.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      const result = await analysesApi.start(source.id);
      router.push(`/analyses/${encodeURIComponent(result.id)}`);
    } catch (err) {
      setError(analysisError(err));
      setHistoryVersion((value) => value + 1);
      pending.current = false;
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <section className="card form-card analysis-launch">
      <h2>2. AI 마감일 분석</h2>
      <p className="muted">
        추출한 원문에서 마감일 후보를 찾습니다. 분석 결과를 직접 검토하고
        승인해야 실제 마감일이 등록됩니다.
      </p>
      {!extracted && (
        <p className="notice">
          원문 추출이 완료되어야 분석을 시작할 수 있습니다.
        </p>
      )}
      {extracted && (
        <p className="small muted">
          추출한 원문 {textLength.toLocaleString("ko-KR")}자 · 분석 한도
          40,000자
        </p>
      )}
      {textLength > 40000 && (
        <ErrorNotice message="원문이 AI 분석 한도 40,000자를 초과했습니다. 필요한 내용을 나누어 새 텍스트 자료로 등록해 주세요. 원문을 자동으로 자르지 않습니다." />
      )}
      <label className="checkbox analysis-consent">
        <input
          type="checkbox"
          checked={consent}
          aria-labelledby={consentId}
          disabled={disabled || busy || !allowed}
          onChange={(event) =>
            setConsentText(event.target.checked ? source.extracted_text : null)
          }
        />
        <span id={consentId}>
          이 자료의 추출 원문 전체를 Google Gemini에 전송하여 분석하는 데
          동의합니다.
        </span>
      </label>
      <button
        disabled={disabled || busy || !consent || !allowed}
        onClick={() => void start()}
      >
        {busy ? "분석 요청 중…" : "AI 분석 시작"}
      </button>
      {error && <ErrorNotice message={error} />}
      <div className="analysis-history">
        <h3>분석 기록</h3>
        <AnalysisHistory
          key={`${source.id}-${page}-${historyVersion}`}
          sourceId={source.id}
          page={page}
          onPage={setPage}
          onProcessing={setHasProcessing}
        />
      </div>
    </section>
  );
}
function AnalysisHistory({
  sourceId,
  page,
  onPage,
  onProcessing,
}: {
  sourceId: string;
  page: number;
  onPage: (page: number) => void;
  onProcessing: (value: boolean) => void;
}) {
  const loader = useCallback(async () => {
    try {
      const results = await analysesApi.list(sourceId, page * 10);
      // Only the newest page is authoritative for the active job.
      if (page === 0)
        onProcessing(results.some((item) => item.status === "processing"));
      return results;
    } catch (err) {
      throw new Error(analysisError(err));
    }
  }, [sourceId, page, onProcessing]);
  const { data, loading, error, reload } = useResource(loader);
  if (loading) return <Loading />;
  if (error) return <ErrorNotice message={error} retry={reload} />;
  return (
    <>
      {data?.length ? (
        <ul className="analysis-history-list">
          {data.map((item) => (
            <li key={item.id}>
              <Link href={`/analyses/${encodeURIComponent(item.id)}`}>
                {formatSeoul(item.created_at)} ·{" "}
                {analysisStatusLabel(item.status)} →
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title="분석 기록이 없습니다">
          원문을 추출한 뒤 첫 분석을 시작해 보세요.
        </Empty>
      )}
      <div className="pagination">
        <button
          className="secondary"
          disabled={page === 0}
          onClick={() => onPage(page - 1)}
        >
          이전 기록
        </button>
        <span>{page + 1} 페이지</span>
        <button
          className="secondary"
          disabled={(data?.length ?? 0) < 10}
          onClick={() => onPage(page + 1)}
        >
          다음 기록
        </button>
      </div>
    </>
  );
}
