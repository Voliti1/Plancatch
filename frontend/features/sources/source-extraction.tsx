"use client";
import { useCallback, useRef, useState } from "react";
import { ErrorNotice } from "@/components/feedback";
import { analysisError } from "@/features/analyses/errors";
import { useProcessingPoll } from "@/lib/api/use-processing-poll";
import type { Source } from "@/types/api";
import { sourcesApi } from "./api";

const isProcessing = (source: Source) =>
  source.processing_status === "processing";
export function SourceExtraction({
  source,
  disabled,
  onUpdate,
  onBusy,
}: {
  source: Source;
  disabled: boolean;
  onUpdate: (source: Source) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const read = useCallback(
    (signal: AbortSignal) => sourcesApi.get(source.id, signal),
    [source.id],
  );
  const processing = isProcessing(source);
  const poll = useProcessingPoll({
    active: processing,
    read,
    isProcessing,
    onData: onUpdate,
    formatError: analysisError,
  });
  async function extract() {
    if (pending.current || processing || disabled) return;
    pending.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      const result = await sourcesApi.extract(source.id);
      poll.resume();
      onUpdate(result);
    } catch (err) {
      setError(analysisError(err));
    } finally {
      pending.current = false;
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <section className="card form-card">
      <h2>1. 원문 추출</h2>
      <p className="muted">
        URL은 공개 페이지의 HTML 본문을 읽습니다. 로그인 우회·JavaScript
        실행·PDF 및 이미지 추출은 지원하지 않습니다.
      </p>
      {processing && (
        <p role="status">
          원문을 추출하고 있습니다. 상태를 자동으로 확인합니다.
        </p>
      )}
      {source.processing_status === "extracted" && (
        <p className="success">
          원문 추출이 완료되었습니다. AI 분석은 별도로 시작해 주세요.
        </p>
      )}
      {poll.timedOut && (
        <ErrorNotice
          message="90초 동안 완료 상태를 확인하지 못했습니다. 자동 조회를 중단했습니다. 잠시 후 상태를 다시 확인해 주세요."
          retry={poll.resume}
        />
      )}
      {poll.error && <ErrorNotice message={poll.error} retry={poll.resume} />}
      {error && <ErrorNotice message={error} />}
      {source.source_type === "url" || source.source_type === "text" ? (
        <button
          className="secondary"
          disabled={disabled || busy || processing}
          onClick={() => void extract()}
        >
          {busy
            ? "요청 중…"
            : processing
              ? "추출 중…"
              : source.processing_status === "pending"
                ? "원문 추출"
                : "원문 다시 추출"}
        </button>
      ) : (
        <p>이 자료 유형의 원문 추출은 아직 지원하지 않습니다.</p>
      )}
      {error && (
        <button
          className="secondary"
          disabled={busy || disabled}
          onClick={async () => {
            try {
              onUpdate(await sourcesApi.get(source.id));
              setError("");
            } catch (err) {
              setError(analysisError(err));
            }
          }}
        >
          자료 상태 확인
        </button>
      )}
    </section>
  );
}
