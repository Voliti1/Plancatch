"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorNotice, Loading } from "@/components/feedback";
import { PageHeading } from "@/components/page-heading";
import { useResource } from "@/lib/api/use-resource";
import { useProcessingPoll } from "@/lib/api/use-processing-poll";
import { formatSeoul } from "@/lib/date/seoul";
import type { Analysis } from "@/types/analysis";
import { analysesApi } from "./api";
import { analysisError, processingError } from "./errors";
import { analysisStatusLabel, isHtmlAnalysis } from "./display";
import { CandidateEvidence, ReviewEditor } from "./review-editor";
import { ReviewSummary } from "./review-summary";
import {
  RemainingPeriod,
  SourcePeriodSummary,
  usePeriodClock,
} from "./remaining-period";

export function AnalysisDetail({ id }: { id: string }) {
  const loader = useCallback(async () => {
    try {
      return await analysesApi.get(id);
    } catch (err) {
      throw new Error(analysisError(err));
    }
  }, [id]);
  const { data, loading, error, reload } = useResource(loader);
  if (loading) return <Loading />;
  if (error)
    return (
      <>
        <Link className="back-link" href="/sources">
          ← 원본 자료 목록
        </Link>
        <ErrorNotice message={error} retry={reload} />
      </>
    );
  return data ? <AnalysisSession initial={data} /> : null;
}
const isProcessing = (analysis: Analysis) => analysis.status === "processing";
function AnalysisSession({ initial }: { initial: Analysis }) {
  const router = useRouter();
  const now = usePeriodClock();
  const [data, setData] = useState(initial);
  const fromHtml = isHtmlAnalysis(data.model);
  const [notice, setNotice] = useState("");
  const [recovering, setRecovering] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");
  const recoveryPending = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const read = useCallback(
    (signal: AbortSignal) => analysesApi.get(initial.id, signal),
    [initial.id],
  );
  const poll = useProcessingPoll({
    active: isProcessing(data),
    read,
    isProcessing,
    onData: setData,
    formatError: analysisError,
  });
  return (
    <>
      <Link
        className="back-link"
        href={`/sources/${encodeURIComponent(data.source_id)}`}
      >
        ← 원본 자료 상세
      </Link>
      <PageHeading
        eyebrow={fromHtml ? "HTML DEADLINE REVIEW" : "AI DEADLINE REVIEW"}
        title={fromHtml ? "마감일 검토" : "AI 마감일 검토"}
        description="추출된 마감일과 짧은 근거를 확인하고 필요한 마감일만 승인하세요."
      />
      <p>
        <span className="tag">
          {analysisStatusLabel(data.status, data.model)}
        </span>{" "}
        <span className="small muted">
          분석 요청 {formatSeoul(data.created_at)}
        </span>
      </p>
      {fromHtml && (
        <p className="success">
          URL의 HTML 직접 분석 방식입니다. Gemini를 호출하거나 원문을 외부 AI에
          전송하지 않습니다.
        </p>
      )}
      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}
      {isProcessing(data) && (
        <p className="notice" role="status">
          {fromHtml
            ? "HTML 접수기간을 확인하고 있습니다."
            : "AI가 마감일 후보를 분석하고 있습니다. 완료될 때까지 상태를 확인합니다."}
        </p>
      )}
      {poll.error && <ErrorNotice message={poll.error} retry={poll.resume} />}
      {poll.timedOut && (
        <ErrorNotice
          message="90초 동안 분석 완료를 확인하지 못했습니다. 자동 조회를 중단했습니다. 잠시 후 다시 확인해 주세요."
          retry={poll.resume}
        />
      )}
      {data.status === "failed" && (
        <ErrorNotice
          message={processingError(
            data.error_message ?? "ai_processing_failed",
          )}
        />
      )}
      {data.status === "failed" && (
        <p>
          <Link
            className="source-detail-link"
            href={`/sources/${encodeURIComponent(data.source_id)}`}
          >
            자료로 돌아가 다시 분석하기 →
          </Link>
        </p>
      )}
      {data.status === "failed" &&
      (data.date_choices?.length || data.source_period) ? (
        <section className="card">
          <h2>읽어 온 날짜로 검토 계속하기</h2>
          <p>
            기존 오류 기록은 유지합니다. 같은 원문을 외부 AI에 보내지 않고 새
            HTML 검토를 만듭니다.
          </p>
          <ul>
            {data.date_choices?.map((choice) => (
              <li key={choice.id}>{choice.raw_text}</li>
            ))}
          </ul>
          <button
            disabled={recovering}
            onClick={async () => {
              if (recoveryPending.current) return;
              recoveryPending.current = true;
              setRecovering(true);
              setRecoveryError("");
              try {
                const result = await analysesApi.recoverHtml(data.id);
                if (!active.current) return;
                router.push(`/analyses/${encodeURIComponent(result.id)}`);
              } catch (err) {
                if (!active.current) return;
                setRecoveryError(analysisError(err));
                recoveryPending.current = false;
                setRecovering(false);
              }
            }}
          >
            {recovering ? "검토 준비 중…" : "HTML 날짜로 검토 계속"}
          </button>
          {recoveryError && <ErrorNotice message={recoveryError} />}
        </section>
      ) : null}
      {data.warnings.length > 0 && (
        <section
          className="notice analysis-warnings"
          aria-label="분석 주의사항"
        >
          <h2>주의사항</h2>
          <ul>
            {data.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </section>
      )}
      <div
        className={`analysis-overview${data.source_period ? " has-period" : ""}`}
      >
        {data.source_period && (
          <SourcePeriodSummary period={data.source_period} now={now} />
        )}
        <ReviewSummary analysis={data} />
      </div>
      {data.status === "approved" && (
        <section className="card analysis-approved">
          <h2>마감일 등록 완료</h2>
          <p>
            선택한 후보 {data.approved_deadline_ids.length}개를 마감일로
            등록했습니다.
          </p>
          <ul>
            {data.approved_deadline_ids.map((id, index) => (
              <li key={id}>
                <Link
                  className="source-detail-link"
                  href={`/deadlines/${encodeURIComponent(id)}`}
                >
                  생성된 마감일 {index + 1} 보기 →
                </Link>
              </li>
            ))}
          </ul>
          <Link className="button secondary" href="/deadlines">
            마감일 목록 보기
          </Link>
          <p className="small muted">
            작업 생성·자동 배치·Google Calendar 동기화는 수행하지 않습니다.
          </p>
        </section>
      )}
      {data.status === "rejected" && (
        <p className="notice" role="status">
          분석 결과를 전체 거부했습니다. 이 분석으로 생성된 마감일은 없습니다.
        </p>
      )}
      <div className="analysis-grid">
        <section className="card analysis-review">
          <h2>마감일 후보</h2>
          <p className="small muted">
            {fromHtml
              ? "HTML에 명시된 마감일을 사용합니다. 기업이 마감일을 변경할 수 있으므로 원문도 확인해 주세요."
              : "AI 신뢰도는 모델의 참고값이며 사실의 정확도를 보장하지 않습니다. 원문을 직접 확인해 주세요."}
          </p>
          {data.status === "ready" ? (
            <ReviewEditor
              key={`${data.id}-${data.revision}`}
              analysis={data}
              now={now}
              onUpdated={(result, message) => {
                setData(result);
                setNotice(message);
              }}
            />
          ) : (
            <>
              {data.candidates.map((candidate, index) => (
                <article className="analysis-candidate" key={candidate.id}>
                  <h3>
                    후보 {index + 1} · {candidate.title}
                  </h3>
                  <p>
                    {candidate.selected ? "포함" : "제외"} ·{" "}
                    {candidate.due_at
                      ? formatSeoul(candidate.due_at)
                      : "마감일 확인 필요"}
                  </p>
                  <RemainingPeriod dueAt={candidate.due_at} now={now} />
                  {candidate.description && (
                    <p className="analysis-text">{candidate.description}</p>
                  )}
                  <CandidateEvidence
                    candidate={candidate}
                    fromHtml={fromHtml}
                  />
                </article>
              ))}
              {!isProcessing(data) && data.candidates.length === 0 && (
                <p>마감일 후보가 없습니다.</p>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}
