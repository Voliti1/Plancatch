"use client";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { api, ApiError, errorMessage } from "@/lib/api/client";
import { formatSeoul } from "@/lib/date/seoul";
import type { Recurrence } from "@/features/tasks/recurrence-settings";
import "./overlap-warning.css";

export type OverlapInput = {
  start_at: string;
  end_at: string;
  recurrence?: Recurrence | null;
  exclude_task_id?: string;
  exclude_event_id?: string;
  placement_task_id?: string;
  exclude_occurrence_task_id?: string;
  exclude_occurrence_start?: string;
};
type Result = {
  conflicts: {
    kind: "task" | "event" | "google";
    id: string;
    task_id: string | null;
    title: string;
    start_at: string;
    end_at: string;
    proposed_start_at: string;
    proposed_end_at: string;
    is_recurring: boolean;
    is_all_day?: boolean;
  }[];
  checked_from: string;
  checked_until: string;
  truncated: boolean;
  coverage_limited: boolean;
  is_recurring: boolean;
  google_state?:
    | "checked"
    | "partial"
    | "not_connected"
    | "unavailable"
    | "reconnect_required";
  google_message?: string | null;
};
type Warning = { key: string; result?: Result; error?: string };
function googleIncomplete(result?: Result) {
  return Boolean(
    result?.google_state &&
    !["checked", "not_connected"].includes(result.google_state),
  );
}

export function useOverlapCheck() {
  const [warning, setWarning] = useState<Warning | null>(null);
  const [checking, setChecking] = useState(false);
  const approval = useRef<string | null>(null);
  const active = useRef(true);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      request.current?.abort();
    };
  }, []);
  function clear() {
    approval.current = null;
    setWarning(null);
  }
  async function check(input: OverlapInput) {
    const key = JSON.stringify(input);
    if (approval.current === key) {
      clear();
      return true;
    }
    clear();
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setChecking(true);
    try {
      const result = await api<Result>("/api/schedules/conflicts", {
        method: "POST",
        body: JSON.stringify(input),
        signal: controller.signal,
        timeoutMs: 30000,
      });
      if (!active.current || controller.signal.aborted) return false;
      if (
        !result.conflicts.length &&
        !result.truncated &&
        !googleIncomplete(result)
      )
        return true;
      setWarning({ key, result });
    } catch (error) {
      if (!active.current || controller.signal.aborted) return false;
      if (error instanceof ApiError && [401, 403, 422].includes(error.status))
        throw error;
      setWarning({ key, error: errorMessage(error) });
    } finally {
      if (active.current) setChecking(false);
    }
    return false;
  }
  return {
    check,
    clear,
    warning,
    checking,
    approve: () => {
      approval.current = warning?.key ?? null;
    },
  };
}

export function OverlapWarning({
  check,
  busy,
}: {
  check: ReturnType<typeof useOverlapCheck>;
  busy: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const id = useId();
  useEffect(() => {
    if (check.warning) heading.current?.focus();
  }, [check.warning]);
  const warning = check.warning;
  if (!warning) return null;
  const result = warning.result;
  return (
    <section className="overlap-warning" aria-labelledby={id}>
      <h3 id={id} ref={heading} tabIndex={-1}>
        {warning.error
          ? "겹치는 일정을 확인하지 못했습니다"
          : result?.conflicts.length
            ? "시간이 겹치는 일정이 있습니다"
            : googleIncomplete(result)
              ? "구글 일정 확인이 필요합니다"
              : "일부 일정만 확인했습니다"}
      </h3>
      {warning.error && (
        <p role="status">
          {warning.error} 다시 저장을 누르면 재확인합니다. 확인 없이 저장할 수도
          있습니다.
        </p>
      )}
      {result && (
        <>
          <p className="small muted">
            확인 범위: {formatSeoul(result.checked_from)} ~{" "}
            {formatSeoul(result.checked_until)} ·{" "}
            {result.google_state === "checked" ||
            result.google_state === "partial"
              ? "플랜캐치·구글 기본 캘린더 기준"
              : "플랜캐치 일정 기준"}
          </p>
          {result.google_message && (
            <p>{result.google_message} 다시 저장을 누르면 재확인합니다.</p>
          )}
          {result.google_state === "reconnect_required" && (
            <p>
              <Link href="/settings/google-calendar">
                구글 계정 연결 확인 →
              </Link>
            </p>
          )}
          <ul>
            {result.conflicts.map((item) => (
              <li key={`${item.kind}:${item.id}:${item.start_at}`}>
                {item.kind === "google" ? (
                  <strong>
                    {item.title}{" "}
                    <span className="small muted">
                      Google Calendar{item.is_all_day ? " · 종일" : ""}
                    </span>
                  </strong>
                ) : (
                  <Link
                    href={`/tasks/${encodeURIComponent(item.task_id!)}${item.is_recurring ? `?${new URLSearchParams({ occurrence: item.start_at })}` : ""}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {item.title} ↗
                  </Link>
                )}
                <span>
                  {formatSeoul(item.start_at)} ~ {formatSeoul(item.end_at)}
                  {item.is_recurring ? " · 반복 일정" : ""}
                </span>
                {result.is_recurring && (
                  <span className="small muted">
                    입력한 반복 회차: {formatSeoul(item.proposed_start_at)} ~{" "}
                    {formatSeoul(item.proposed_end_at)}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {result.truncated && (
            <p>
              조회 한도에 도달해 일부 일정이나 겹침 내역이 생략됐습니다. 다른
              겹침이 있을 수 있습니다.
            </p>
          )}
          {result.coverage_limited && (
            <p className="small muted">
              반복 또는 긴 일정의 나머지 기간에는 다른 겹침이 있을 수 있습니다.
            </p>
          )}
        </>
      )}
      <div className="form-actions">
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={(event) => {
            check.clear();
            event.currentTarget
              .closest("form")
              ?.querySelector<HTMLInputElement>('input[type="datetime-local"]')
              ?.focus();
          }}
        >
          시간 변경
        </button>
        <button type="submit" disabled={busy} onClick={check.approve}>
          {warning.error
            ? "확인 없이 저장"
            : result?.conflicts.length
              ? "겹쳐도 저장"
              : googleIncomplete(result)
                ? "구글 확인 없이 저장"
                : "확인한 범위로 저장"}
        </button>
      </div>
    </section>
  );
}

export function OverlapScope() {
  return (
    <p className="small muted">
      저장 전에 플랜캐치의 고정·반복 일정과 확정된 배치 시간의 겹침을
      확인합니다. Google 계정이 연결되어 있으면 기본 캘린더의 바쁨 일정도
      포함합니다. 한 번에 최대 90일을 확인하며 반복은 첫 일정 또는 오늘부터
      확인합니다.
    </p>
  );
}
