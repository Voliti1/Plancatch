"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorNotice, Loading } from "@/components/feedback";
import { api, errorMessage } from "@/lib/api/client";
import { useResource } from "@/lib/api/use-resource";

type Kind = "deadline" | "task" | "event";
type SyncStatus = {
  state:
    | "not_connected"
    | "pending"
    | "retrying"
    | "failed"
    | "synced"
    | "deleted"
    | "ready"
    | "not_scheduled";
  note: string;
  retryable: boolean;
};
const prefix = "/api/integrations/google-calendar/auto-sync";
export function GoogleExportPanel({
  kind,
  itemId,
  disabled = false,
  onChanged,
}: {
  kind: Kind;
  itemId: string;
  disabled?: boolean;
  onChanged?: () => void;
}) {
  const loader = useCallback(
    (signal: AbortSignal) =>
      api<SyncStatus>(
        `${prefix}?kind=${kind}&item_id=${encodeURIComponent(itemId)}`,
        { signal },
      ),
    [kind, itemId],
  );
  const status = useResource(loader);
  const { reload } = status;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false),
    active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    const waiting =
      status.data?.state === "pending" || status.data?.state === "retrying";
    if (!waiting || busy) return;
    const timer = window.setTimeout(
      () => {
        if (document.visibilityState === "visible") reload();
      },
      status.data?.state === "retrying" ? 15000 : 2500,
    );
    return () => window.clearTimeout(timer);
  }, [status.data, busy, reload]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible" && !pending.current) reload();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [reload]);
  async function retry() {
    if (pending.current || disabled) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await api(prefix, {
        method: "POST",
        body: JSON.stringify({ kind, item_id: itemId }),
      });
      if (active.current) {
        reload();
        onChanged?.();
      }
    } catch (failure) {
      if (active.current) setError(errorMessage(failure));
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <section className="card form-card" aria-label="Google 자동 동기화">
      <h2>Google 캘린더 자동 반영</h2>
      <p className="small muted">
        Google 연결 후 등록·수정·삭제한 일정은 자동으로 반영됩니다. 창을 닫아도
        서버에서 처리를 이어갑니다.
      </p>
      {status.loading && !status.data && <Loading />}
      {status.error && <ErrorNotice message={status.error} retry={reload} />}
      {status.data && (
        <>
          <p
            role="status"
            className={`notice ${status.data.state === "synced" || status.data.state === "deleted" ? "success" : ""}`}
          >
            {status.data.note}
          </p>
          {status.data.retryable && (
            <button
              type="button"
              className="secondary"
              disabled={busy || disabled}
              onClick={() => void retry()}
            >
              {busy
                ? "요청 중…"
                : status.data.state === "ready"
                  ? "지금 동기화"
                  : "다시 시도"}
            </button>
          )}
        </>
      )}
      {error && <ErrorNotice message={error} />}
      <p className="small">
        <Link href="/settings/google-calendar">Google 계정 연결 확인 →</Link>
      </p>
    </section>
  );
}
