"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ErrorNotice } from "@/components/feedback";
import { useProcessingPoll } from "@/lib/api/use-processing-poll";
import { useUnsavedChanges } from "@/lib/unsaved-changes";
import type { Analysis } from "@/types/analysis";
import { analysesApi } from "./api";
import { analysisError, processingError } from "./errors";

const MAX_CORRECTED_LENGTH = 40_000;
const isProcessing = (analysis: Analysis) => analysis.status === "processing";

export function ImageTextCorrection({ analysis }: { analysis: Analysis }) {
  const helpId = useId();
  const [text, setText] = useState(analysis.input_text);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Analysis | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const resultId = result?.id;
  const { markSaved } = useUnsavedChanges(text);
  const read = useCallback(
    (signal: AbortSignal) => analysesApi.get(resultId!, signal),
    [resultId],
  );
  const poll = useProcessingPoll({
    active: Boolean(result && isProcessing(result)),
    read,
    isProcessing,
    onData: setResult,
    formatError: analysisError,
  });

  const saved = result?.status === "ready" || result?.status === "approved";
  const working = busy || result?.status === "processing";
  const length = Array.from(text.trim()).length;
  const canSubmit =
    consent &&
    length > 0 &&
    length <= MAX_CORRECTED_LENGTH &&
    text.trim() !== analysis.input_text.trim();
  useEffect(() => {
    if (saved) markSaved();
  }, [markSaved, saved]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || request.current || working || saved) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const next = await analysesApi.correctImageText(
        analysis.id,
        analysis.revision,
        text.trim(),
        controller.signal,
      );
      if (!controller.signal.aborted) {
        poll.resume();
        setResult(next);
      }
    } catch (err) {
      if (!controller.signal.aborted) setError(analysisError(err));
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <details className="image-text-correction">
      <summary>이미지에서 읽은 글 교정</summary>
      <form onSubmit={submit} aria-label="이미지 원문 교정">
        <p id={helpId} className="small muted">
          이미지와 읽어 온 글을 비교해 오타를 고쳐 주세요. 교정한 글로 새 마감일
          후보를 만들고, 마감일은 새 검토에서 승인하면 등록됩니다.
        </p>
        <fieldset disabled={working || saved}>
          <label>
            교정할 원문
            <textarea
              rows={8}
              aria-describedby={helpId}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          {length > MAX_CORRECTED_LENGTH && (
            <ErrorNotice message="교정 원문을 40,000자 이하로 입력해 주세요." />
          )}
          <label className="checkbox">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            교정한 글만 Google Gemini에 보내 분석하는 데 동의합니다.
          </label>
          <button type="submit" disabled={!canSubmit}>
            교정한 글로 다시 분석
          </button>
        </fieldset>
        {working && <p role="status">교정한 글을 분석하고 있습니다.</p>}
        {error && <ErrorNotice message={error} />}
        {result?.status === "failed" && (
          <ErrorNotice
            message={processingError(
              result.error_message ?? "ai_processing_failed",
            )}
          />
        )}
        {(poll.error || poll.timedOut) && (
          <ErrorNotice
            message={
              poll.error ||
              "90초 동안 결과를 확인하지 못했습니다. 진행 상태를 다시 확인해 주세요."
            }
            retry={poll.resume}
          />
        )}
        {saved && resultId && (
          <p role="status">
            새 검토가 준비됐습니다.{" "}
            <Link href={`/analyses/${encodeURIComponent(resultId)}`}>
              교정한 글의 검토 결과 보기 →
            </Link>
          </p>
        )}
      </form>
    </details>
  );
}
