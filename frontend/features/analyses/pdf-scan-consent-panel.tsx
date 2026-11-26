"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorNotice } from "@/components/feedback";
import { useAuth } from "@/features/auth/provider";
import { setPdfScanConsent } from "@/features/settings/pdf-scan-consent";
import type { Analysis } from "@/types/analysis";
import { analysesApi } from "./api";
import { analysisError } from "./errors";

export function PdfScanConsentPanel({ analysis }: { analysis: Analysis }) {
  const router = useRouter();
  const userId = useAuth().user?.id;
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    if (pending.current || !userId || !analysis.input_hash) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await analysesApi.start(
        analysis.source_id,
        AbortSignal.timeout(15000),
        true,
        analysis.input_hash,
        false,
      );
      if (remember) setPdfScanConsent(userId, true);
      router.replace(`/analyses/${encodeURIComponent(result.id)}`);
    } catch (err) {
      setError(analysisError(err));
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="card form-card" aria-label="스캔 PDF 전송 동의">
      <h2>스캔 PDF 읽기</h2>
      <p>
        이 PDF에서 글자를 직접 읽지 못했어요. 동의하면 원본 PDF를 AI(구글
        Gemini)에 보내 글자를 읽어요.
      </p>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={remember}
          disabled={busy}
          onChange={(event) => setRemember(event.target.checked)}
        />
        앞으로 스캔 PDF에도 적용
      </label>
      <p className="small muted">
        선택하면 이 브라우저에서 현재 계정에만 적용돼요. 설정에서 끌 수 있어요.
      </p>
      <button
        type="button"
        disabled={busy || !userId || !analysis.input_hash}
        onClick={start}
      >
        {busy ? "스캔 읽기 준비 중…" : "동의하고 스캔 읽기"}
      </button>
      {error && <ErrorNotice message={error} />}
    </section>
  );
}
