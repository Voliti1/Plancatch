"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PageHeading } from "@/components/page-heading";
import { ErrorNotice } from "@/components/feedback";
import { analysesApi } from "@/features/analyses/api";
import { analysisError, processingError } from "@/features/analyses/errors";
import { useAuth } from "@/features/auth/provider";
import {
  hasPdfScanConsent,
  PDF_SCAN_CONSENT_REQUIRED,
} from "@/features/settings/pdf-scan-consent";
import type { Source } from "@/types/api";
import { sourcesApi } from "./api";
import { SourceImage } from "./source-image";

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

export function SourceReview({
  id,
  reanalyzePdf = false,
}: {
  id: string;
  reanalyzePdf?: boolean;
}) {
  const router = useRouter();
  const userId = useAuth().user?.id;
  const [source, setSource] = useState<Source | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(true);
  const [progress, setProgress] = useState("저장한 자료를 확인하고 있어요.");
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
        if (!["url", "text", "image", "pdf"].includes(item.source_type))
          throw new Error("이 자료 유형은 아직 검토할 수 없어요.");
        setSource(item);
        if (item.source_type === "image" || item.source_type === "pdf") {
          const digest =
            item.source_type === "pdf" ? item.pdf_sha256 : item.image_sha256;
          if (!digest) throw new Error("저장한 파일 버전을 확인하지 못했어요.");
          const history = await analysesApi.list(id, 0, requestSignal());
          signal.throwIfAborted();
          const matching = history.filter(
            (entry) =>
              entry.model.startsWith(`${item.source_type}:`) &&
              entry.input_hash === digest,
          );
          const existing =
            item.source_type === "image"
              ? (matching.find((entry) => entry.status === "processing") ??
                matching.find(
                  (entry) =>
                    entry.status !== "failed" &&
                    entry.input_text === item.extracted_text,
                ) ??
                matching[0])
              : matching[0];
          const redo =
            reanalyzePdf &&
            item.source_type === "pdf" &&
            existing?.status === "ready";
          const awaitingScan =
            existing?.error_message === PDF_SCAN_CONSENT_REQUIRED;
          const savedConsent =
            item.source_type === "pdf" && hasPdfScanConsent(userId);
          if (
            existing &&
            !redo &&
            (existing.status !== "failed" || (awaitingScan && !savedConsent))
          ) {
            router.replace(`/analyses/${encodeURIComponent(existing.id)}`);
            return;
          }
          if (item.source_type === "image" && consent.current !== digest) {
            setProgress(
              existing
                ? "이전 분석에 실패했어요. 파일 전송에 동의한 뒤 다시 시도할 수 있어요."
                : "AI 전송에 동의하면 저장한 파일을 분석해요.",
            );
            return;
          }
          if (item.source_type === "pdf")
            setProgress("PDF에서 접수·제출 기간을 확인하고 있어요.");
          const analysis = await analysesApi.start(
            id,
            requestSignal(),
            item.source_type === "image" || savedConsent,
            digest,
            !existing,
          );
          signal.throwIfAborted();
          router.replace(`/analyses/${encodeURIComponent(analysis.id)}`);
          return;
        }
        setProgress("내용을 불러오고 있어요.");
        if (!["extracted", "processing"].includes(item.processing_status))
          item = await sourcesApi.extract(id, requestSignal());
        const expires = Date.now() + 90000;
        while (item.processing_status === "processing") {
          if (Date.now() >= expires)
            throw new Error(
              "90초 동안 완료 상태를 확인하지 못했어요. 자료는 저장되어 있으니 잠시 후 상태를 다시 확인해 주세요.",
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
            entry.error_message !== "processing_interrupted" &&
            (item.source_type !== "url" || entry.model.startsWith("html:")),
        );
        if (existing) {
          router.replace(`/analyses/${encodeURIComponent(existing.id)}`);
          return;
        }
        if (item.source_type === "text") {
          if (Array.from(item.extracted_text).length > 40000)
            throw new Error(
              "자료 내용이 AI 분석 한도 40,000자를 초과했어요. 필요한 내용을 나누어 새 자료로 등록해 주세요.",
            );
          if (consent.current !== item.extracted_text) {
            setProgress("AI 전송에 동의하면 바로 검토를 시작해요.");
            return;
          }
        }
        if (!item.extracted_text_hash)
          throw new Error(
            "자료의 자료 내용 버전을 확인하지 못했어요. 상태를 다시 확인해 주세요.",
          );
        setProgress(
          item.source_type === "url"
            ? "페이지에서 마감일을 확인하고 있어요."
            : "찾은 날짜 확인를 시작하고 있어요.",
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
  }, [id, attempt, reanalyzePdf, router, userId]);
  const image = source?.source_type === "image";
  const consentVersion = image ? source?.image_sha256 : source?.extracted_text;
  const needsConsent =
    image ||
    (source?.source_type === "text" &&
      source.processing_status === "extracted");
  const accepted = Boolean(consentVersion && consentText === consentVersion);
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
        ← 자료 목록
      </Link>
      <PageHeading
        eyebrow="DEADLINE REVIEW"
        title="마감일 검토 준비"
        description="자료를 저장했어요. 내용 불러오기 후 바로 검토 화면으로 연결해요."
      />
      <section className="card form-card" aria-label="등록한 자료 검토">
        <h2>{source?.title || "저장한 자료"}</h2>
        <p role="status">{progress}</p>
        <p className="small muted">
          URL은 외부 AI 전송 없이 페이지에서 날짜를 찾아요. 검토 결과를 승인하기
          전에는 마감일이나 구글 캘린더 일정이 생성되지 않아요.
        </p>
        {needsConsent && !busy && !error && (
          <>
            {image ? (
              <p>
                원본 이미지 한 장을 AI(구글 Gemini)로 전송해요. 날짜·시각과
                제목이 불명확하면 직접 입력한 뒤 승인해요.
              </p>
            ) : (
              <p>
                입력한 자료 내용{" "}
                {Array.from(source?.extracted_text ?? "").length.toLocaleString(
                  "ko-KR",
                )}
                자를 분석해요.
              </p>
            )}
            <label className="checkbox">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(event) => {
                  const value = event.target.checked
                    ? (consentVersion ?? null)
                    : null;
                  consent.current = value;
                  setConsentText(value);
                }}
              />
              {image
                ? "이 원본 이미지를 AI(구글 Gemini)에 전송하여 분석하는 데 동의해요."
                : "마감일을 찾기 위해 이 글 내용 전체를 AI(구글 Gemini)에 보내 분석하는 데 동의해요."}
            </label>
            <button disabled={!accepted} onClick={retry}>
              동의하고 찾은 날짜 확인 시작
            </button>
          </>
        )}
        {error && (
          <>
            <ErrorNotice message={error} />
            <p className="small muted">
              자료를 다시 저장하지 않아요. 같은 자료의 진행 상태와 기존 검토
              결과부터 확인해요.
            </p>
            <button className="secondary" disabled={busy} onClick={retry}>
              진행 상태 확인·다시 시도
            </button>
          </>
        )}
        <p className="small">
          <Link href={`/sources/${encodeURIComponent(id)}`}>
            저장된 자료 확인 →
          </Link>
        </p>
      </section>
      {image && <SourceImage id={id} />}
    </>
  );
}
