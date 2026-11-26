"use client";
import { useScheduleTime } from "@/features/settings/time-zone";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ErrorNotice, Loading } from "@/components/feedback";
import { PageHeading } from "@/components/page-heading";
import { useResource } from "@/lib/api/use-resource";
import { useProcessingPoll } from "@/lib/api/use-processing-poll";
import type { Analysis } from "@/types/analysis";
import { analysesApi } from "./api";
import { analysisError, processingError } from "./errors";
import {
  analysisStatusLabel,
  isExtractedPdf,
  isHtmlAnalysis,
  warningLabel,
} from "./display";
import { CandidateEvidence, ReviewEditor } from "./review-editor";
import { ReviewSummary } from "./review-summary";
import { ImageTextCorrection } from "./image-text-correction";
import { PdfScanConsentPanel } from "./pdf-scan-consent-panel";
import { PDF_SCAN_CONSENT_REQUIRED } from "@/features/settings/pdf-scan-consent";
import { SourceImage } from "@/features/sources/source-image";
import {
  RemainingPeriod,
  SourcePeriodSummary,
  usePeriodClock,
} from "./remaining-period";

export function AnalysisDetail({ id }: { id: string }) {
  const router = useRouter();
  const loader = useCallback(async () => {
    try {
      return await analysesApi.get(id);
    } catch (err) {
      throw new Error(analysisError(err));
    }
  }, [id]);
  const { data, loading, error, reload } = useResource(loader);
  useEffect(() => {
    if (data && data.id !== id)
      router.replace(`/analyses/${encodeURIComponent(data.id)}`);
  }, [data, id, router]);
  if (loading) return <Loading />;
  if (error)
    return (
      <>
        <Link className="back-link" href="/sources">
          ← 자료 목록
        </Link>
        <ErrorNotice message={error} retry={reload} />
      </>
    );
  return data ? <AnalysisSession initial={data} /> : null;
}
const isProcessing = (analysis: Analysis) => analysis.status === "processing";
function AnalysisSession({ initial }: { initial: Analysis }) {
  const { formatLocal } = useScheduleTime();
  const router = useRouter();
  const now = usePeriodClock();
  const [data, setData] = useState(initial);
  const [showSnapshot, setShowSnapshot] = useState(false);
  const snapshotId = useId();
  const hasSnapshot =
    data.status !== "processing" &&
    Boolean(data.input_text.trim()) &&
    data.input_text !== "파일 분석 준비 중";
  const fromHtml = isHtmlAnalysis(data.model);
  const fromPdf = isExtractedPdf(data.model);
  const needsScanConsent =
    fromPdf &&
    data.status === "failed" &&
    data.error_message === PDF_SCAN_CONSENT_REQUIRED;
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
  const onData = useCallback(
    (next: Analysis) => {
      if (next.id !== initial.id)
        router.replace(`/analyses/${encodeURIComponent(next.id)}`);
      setData(next);
    },
    [initial.id, router],
  );
  const poll = useProcessingPoll({
    active: isProcessing(data),
    read,
    isProcessing,
    onData,
    formatError: analysisError,
  });
  return (
    <>
      <Link
        className="back-link"
        href={`/sources/${encodeURIComponent(data.source_id)}`}
      >
        ← 자료 상세
      </Link>
      <PageHeading
        eyebrow={
          fromPdf
            ? "PDF DEADLINE REVIEW"
            : fromHtml
              ? "마감일 확인"
              : "마감일 확인"
        }
        title={fromHtml || fromPdf ? "마감일 검토" : "AI 마감일 검토"}
        description="추출된 마감일과 짧은 근거를 확인하고 필요한 마감일만 승인하세요."
      />
      <p>
        <span className="tag">
          {needsScanConsent
            ? "전송 동의 대기"
            : analysisStatusLabel(data.status, data.model)}
        </span>{" "}
        <span className="small muted">
          분석 요청 {formatLocal(data.created_at)}
        </span>
      </p>
      {fromHtml && (
        <p className="success">
          링크에 적힌 내용을 직접 읽은 결과예요. Gemini를 호출하거나 자료 내용을
          외부 AI에 전송하지 않아요.
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
            ? "페이지의 접수 기간을 확인하고 있어요."
            : fromPdf
              ? "PDF에서 접수·제출 기간을 확인하고 있어요."
              : "AI가 찾은 마감일을 분석하고 있어요. 완료될 때까지 상태를 확인해요."}
        </p>
      )}
      {poll.error && <ErrorNotice message={poll.error} retry={poll.resume} />}
      {poll.timedOut && (
        <ErrorNotice
          message="90초 동안 분석 완료를 확인하지 못했어요. 자동 조회를 중단했어요. 잠시 후 다시 확인해 주세요."
          retry={poll.resume}
        />
      )}
      {needsScanConsent && <PdfScanConsentPanel analysis={data} />}
      {data.status === "failed" && !needsScanConsent && (
        <ErrorNotice
          message={processingError(
            data.error_message ?? "ai_processing_failed",
          )}
        />
      )}
      {data.status === "failed" && !needsScanConsent && (
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
            기존 오류 기록은 유지해요. 같은 자료 내용을 외부 AI에 보내지 않고 새
            마감일 확인를 만듭니다.
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
            {recovering ? "검토 준비 중…" : "페이지의 날짜로 검토 계속"}
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
              <li key={index}>{warningLabel(warning)}</li>
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
      {data.model.startsWith("image:") && <SourceImage id={data.source_id} />}
      {data.status === "approved" && (
        <section className="card analysis-approved">
          <h2>마감일 등록 완료</h2>
          <p>
            선택한 찾은 마감일 {data.approved_deadline_ids.length}개를 마감일로
            등록했어요.
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
            일정 목록 보기
          </Link>
          <p className="small muted">
            구글 계정이 연결되어 있으면 등록한 마감일이 구글 캘린더에도 자동
            반영돼요.
          </p>
        </section>
      )}
      {data.status === "rejected" && (
        <p className="notice" role="status">
          분석 결과를 전체 거부했어요. 이 분석으로 생성된 마감일은 없어요.
        </p>
      )}
      {hasSnapshot && (
        <button
          type="button"
          className="secondary analysis-snapshot-toggle"
          aria-expanded={showSnapshot}
          aria-controls={snapshotId}
          onClick={() => setShowSnapshot((open) => !open)}
        >
          {showSnapshot ? "분석 자료 내용 접기" : "분석 자료 내용 보기"}
        </button>
      )}
      <div
        className={`analysis-grid${hasSnapshot && showSnapshot ? " with-snapshot" : ""}`}
      >
        {hasSnapshot && (
          <section
            id={snapshotId}
            className="card analysis-snapshot"
            aria-labelledby={`${snapshotId}-heading`}
            hidden={!showSnapshot}
          >
            {showSnapshot && (
              <>
                <h2 id={`${snapshotId}-heading`}>분석에 사용한 자료 내용</h2>
                <p className="small muted">
                  이 결과를 만들 때 저장한 텍스트예요. PDF나 이미지에서 읽은
                  텍스트에는 원본의 일부가 빠질 수 있어요.
                </p>
                <div
                  className="source-text"
                  tabIndex={0}
                  role="region"
                  aria-label="저장된 분석 자료 내용"
                >
                  {data.input_text}
                </div>
              </>
            )}
            {data.status === "ready" && data.model.startsWith("image:") && (
              <ImageTextCorrection key={data.id} analysis={data} />
            )}
          </section>
        )}
        <section className="card analysis-review">
          <h2>찾은 마감일</h2>
          <p className="small muted">
            {fromHtml
              ? "페이지에 적힌 마감일을 사용해요. 기업이 마감일을 변경할 수 있으므로 자료 내용도 확인해 주세요."
              : fromPdf
                ? "PDF에서 읽은 접수·제출 기한이에요. 자료 내용과 날짜를 확인해 주세요."
                : "AI 확신 정도는 참고용이에요. 등록 전 자료와 날짜를 직접 확인해 주세요."}
          </p>
          {data.status === "ready" ? (
            <ReviewEditor
              key={data.id}
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
                    찾은 마감일 {index + 1} · {candidate.title}
                  </h3>
                  <p>
                    {candidate.selected ? "포함" : "제외"} ·{" "}
                    {candidate.due_at
                      ? formatLocal(candidate.due_at)
                      : "마감일 확인 필요"}
                  </p>
                  <RemainingPeriod dueAt={candidate.due_at} now={now} />
                  {candidate.description && (
                    <p className="analysis-text">{candidate.description}</p>
                  )}
                  <CandidateEvidence candidate={candidate} model={data.model} />
                </article>
              ))}
              {!isProcessing(data) && data.candidates.length === 0 && (
                <p>찾은 마감일이 없어요.</p>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}
