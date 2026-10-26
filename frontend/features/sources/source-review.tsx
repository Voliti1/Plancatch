"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PageHeading } from "@/components/page-heading";
import { ErrorNotice } from "@/components/feedback";
import { analysesApi } from "@/features/analyses/api";
import { analysisError, processingError } from "@/features/analyses/errors";
import type { Source } from "@/types/api";
import { sourcesApi } from "./api";

function pause(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const cancel = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, 2000);
    signal.addEventListener("abort", cancel, { once: true });
  });
}

export function SourceReview({ id }: { id: string }) {
  const router = useRouter();
  const [source, setSource] = useState<Source | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(true);
  const [progress, setProgress] = useState("저장한 자료를 확인하고 있습니다.");
  const [error, setError] = useState("");
  const [consentText, setConsentText] = useState<string | null>(null);
  const consent = useRef<string | null>(null);
  const pending = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    const requestSignal = () =>
      AbortSignal.any([signal, AbortSignal.timeout(15000)]);
    async function run() {
      try {
        let item = await sourcesApi.get(id, requestSignal());
        signal.throwIfAborted();
        if (!["url", "text"].includes(item.source_type))
          throw new Error("이 자료 유형은 아직 검토할 수 없습니다.");
        setSource(item);
        setProgress("원문을 추출하고 있습니다.");
        if (!["extracted", "processing"].includes(item.processing_status))
          item = await sourcesApi.extract(id, requestSignal());
        const expires = Date.now() + 90000;
        while (item.processing_status === "processing") {
          if (Date.now() >= expires)
            throw new Error(
              "90초 동안 완료 상태를 확인하지 못했습니다. 자료는 저장되어 있으니 잠시 후 상태를 다시 확인해 주세요.",
            );
          await pause(signal);
          item = await sourcesApi.get(id, requestSignal());
        }
        signal.throwIfAborted();
        setSource(item);
        if (item.processing_status !== "extracted" || !item.extracted_text)
          throw new Error(
            processingError(item.error_message ?? "empty_content"),
          );
        const history = await analysesApi.list(id, 0, requestSignal());
        signal.throwIfAborted();
        const existing = history.find(
          (entry) =>
            entry.input_text === item.extracted_text &&
            (item.source_type !== "url" || entry.model.startsWith("html:")),
        );
        if (existing) {
          router.replace(`/analyses/${encodeURIComponent(existing.id)}`);
          return;
        }
        if (item.source_type === "text") {
          if (Array.from(item.extracted_text).length > 40000)
            throw new Error(
              "원문이 AI 분석 한도 40,000자를 초과했습니다. 필요한 내용을 나누어 새 자료로 등록해 주세요.",
            );
          if (consent.current !== item.extracted_text) {
            setProgress("AI 전송에 동의하면 바로 검토를 시작합니다.");
            return;
          }
        }
        if (!item.extracted_text_hash)
          throw new Error(
            "자료의 원문 버전을 확인하지 못했습니다. 상태를 다시 확인해 주세요.",
          );
        setProgress(
          item.source_type === "url"
            ? "HTML에서 마감일을 확인하고 있습니다."
            : "AI 검토를 시작하고 있습니다.",
        );
        const analysis = await analysesApi.start(
          id,
          requestSignal(),
          item.source_type === "text",
          item.extracted_text_hash,
        );
        signal.throwIfAborted();
        router.replace(`/analyses/${encodeURIComponent(analysis.id)}`);
      } catch (err) {
        if (!signal.aborted) setError(analysisError(err));
      } finally {
        if (!signal.aborted) {
          pending.current = false;
          setBusy(false);
        }
      }
    }
    void run();
    return () => controller.abort();
  }, [id, attempt, router]);
  const needsConsent =
    source?.source_type === "text" && source.processing_status === "extracted";
  const accepted = Boolean(
    source?.extracted_text && consentText === source.extracted_text,
  );
  function retry() {
    if (pending.current || busy) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setAttempt((value) => value + 1);
  }
  return (
    <>
      <Link className="back-link" href="/sources">
        ← 원본 자료 목록
      </Link>
      <PageHeading
        eyebrow="DEADLINE REVIEW"
        title="마감일 검토 준비"
        description="자료를 저장했습니다. 원문 추출 후 바로 검토 화면으로 연결합니다."
      />
      <section className="card form-card" aria-label="등록한 자료 검토">
        <h2>{source?.title || "저장한 자료"}</h2>
        <p role="status">{progress}</p>
        <p className="small muted">
          URL은 외부 AI 전송 없이 HTML에서 날짜를 읽습니다. 검토 결과를 승인하기
          전에는 마감일이나 Google 일정이 생성되지 않습니다.
        </p>
        {needsConsent && !busy && !error && (
          <>
            <p>
              입력한 원문{" "}
              {Array.from(source.extracted_text ?? "").length.toLocaleString(
                "ko-KR",
              )}
              자를 분석합니다.
            </p>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(event) => {
                  const value = event.target.checked
                    ? source.extracted_text
                    : null;
                  consent.current = value;
                  setConsentText(value);
                }}
              />
              이 자료의 추출 원문 전체를 Google Gemini에 전송하여 분석하는 데
              동의합니다.
            </label>
            <button disabled={!accepted} onClick={retry}>
              동의하고 AI 검토 시작
            </button>
          </>
        )}
        {error && (
          <>
            <ErrorNotice message={error} />
            <p className="small muted">
              자료를 다시 저장하지 않습니다. 같은 자료의 진행 상태와 기존 검토
              결과부터 확인합니다.
            </p>
            <button className="secondary" disabled={busy} onClick={retry}>
              진행 상태 확인·다시 시도
            </button>
          </>
        )}
        <p className="small">
          <Link href={`/sources/${encodeURIComponent(id)}`}>
            저장된 원본 자료 확인 →
          </Link>
        </p>
      </section>
    </>
  );
}
