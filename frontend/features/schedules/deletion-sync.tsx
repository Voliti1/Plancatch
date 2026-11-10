"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorNotice, Loading } from "@/components/feedback";
import { Pagination } from "@/components/pagination";
import { api, errorMessage } from "@/lib/api/client";
import { useResource } from "@/lib/api/use-resource";

type Deletion = {
  kind: "deadline" | "task" | "event";
  item_id: string;
  title: string;
  state:
    "deleted" | "pending" | "retrying" | "failed" | "ready" | "not_connected";
  note: string;
  retryable: boolean;
};
const labels: Record<Deletion["state"], string> = {
  deleted: "삭제 완료",
  pending: "삭제 중",
  retrying: "자동 재시도 중",
  failed: "삭제 확인 필요",
  ready: "삭제 요청 필요",
  not_connected: "Google 연결 필요",
};
const prefix = "/api/integrations/google-calendar/auto-sync";

export function DeletionSync({
  refreshKey,
  disabled,
}: {
  refreshKey: number;
  disabled: boolean;
}) {
  const [page, setPage] = useState(0);
  const loader = useCallback(
    (signal: AbortSignal) => {
      // A completed local deletion also refreshes this separate Google queue.
      void refreshKey;
      return api<{ entries: Deletion[]; has_more: boolean }>(
        `${prefix}/deletions?limit=20&offset=${page * 20}`,
        { signal },
      );
    },
    [page, refreshKey],
  );
  const { data, loading, error, reload } = useResource(loader);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [retryError, setRetryError] = useState("");
  const pending = useRef(false);
  const active = useRef(true);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (
      disabled ||
      !data?.entries.some(
        (item) => item.state === "pending" || item.state === "retrying",
      )
    )
      return;
    const timer = window.setTimeout(
      () => {
        if (document.visibilityState === "visible") reload();
      },
      data.entries.some((item) => item.state === "pending") ? 2500 : 15000,
    );
    return () => window.clearTimeout(timer);
  }, [data, disabled, reload]);
  useEffect(() => {
    const refresh = () => {
      if (!disabled && document.visibilityState === "visible") reload();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [disabled, reload]);
  async function retry(item: Deletion) {
    if (pending.current || disabled) return;
    pending.current = true;
    controller.current = new AbortController();
    setRetrying(`${item.kind}:${item.item_id}`);
    setRetryError("");
    try {
      await api(prefix, {
        method: "POST",
        body: JSON.stringify({ kind: item.kind, item_id: item.item_id }),
        signal: AbortSignal.any([
          controller.current.signal,
          AbortSignal.timeout(15000),
        ]),
      });
      if (active.current) reload();
    } catch (failure) {
      if (active.current) setRetryError(errorMessage(failure));
    } finally {
      pending.current = false;
      if (active.current) setRetrying(null);
    }
  }
  if (!data?.entries?.length && !error && page === 0) return null;
  return (
    <section
      className="card google-deletion-status"
      aria-label="Google 캘린더 삭제 상태"
    >
      <div className="section-header">
        <h2>Google 캘린더 삭제 상태</h2>
        <button
          type="button"
          className="secondary"
          disabled={disabled || loading}
          onClick={reload}
        >
          상태 새로고침
        </button>
      </div>
      <p className="small muted">
        플랜캐치에서 삭제한 일정의 Google 반영 상태입니다. 완료 내역은 최근
        24시간 동안 표시됩니다.
      </p>
      {loading && <Loading />}
      {error && <ErrorNotice message={error} retry={reload} />}
      <ul className="google-deletion-rows">
        {data?.entries.map((item) => {
          const key = `${item.kind}:${item.item_id}`;
          return (
            <li key={key}>
              <div>
                <strong>{item.title}</strong>
                <p className="small" role="status">
                  {labels[item.state]} · {item.note}
                </p>
              </div>
              {item.retryable && (
                <button
                  type="button"
                  className="secondary"
                  disabled={disabled || retrying !== null}
                  aria-label={`${item.title} Google 삭제 다시 시도`}
                  onClick={() => void retry(item)}
                >
                  {retrying === key ? "요청 중…" : "다시 시도"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {retryError && <ErrorNotice message={retryError} />}
      <Link href="/settings/google-calendar">Google 계정 연결 확인 →</Link>
      {(page > 0 || data?.has_more) && (
        <Pagination
          page={page}
          count={data?.entries.length ?? 0}
          hasMore={data?.has_more ?? false}
          disabled={disabled || loading || retrying !== null}
          onChange={setPage}
        />
      )}
    </section>
  );
}
