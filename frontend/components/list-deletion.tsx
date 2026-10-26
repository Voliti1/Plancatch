"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "@/lib/api/client";
import { ErrorNotice } from "./feedback";
import "./list-deletion.css";

export function useListDeletion(
  remove: (id: string, signal?: AbortSignal) => Promise<void>,
  onDeleted: () => void,
) {
  const [mode, setMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const active = useRef(true);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      request.current?.abort();
    };
  }, []);
  function exit() {
    if (request.current) return;
    setMode(false);
    setSelected([]);
    setConfirming(false);
    setError("");
    setMessage("");
  }
  function toggleMode() {
    if (request.current) return;
    if (mode) exit();
    else {
      setMode(true);
      setSelected([]);
      setConfirming(false);
      setError("");
      setMessage("");
    }
  }
  function toggle(id: string) {
    if (!mode || request.current) return;
    setSelected((items) =>
      items.includes(id) ? items.filter((item) => item !== id) : [...items, id],
    );
    setConfirming(false);
    setError("");
    setMessage("");
  }
  async function confirmOrDelete() {
    if (!mode || request.current || !selected.length) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    setMessage("");
    const done: string[] = [];
    let conflict = false;
    try {
      for (const id of selected) {
        if (controller.signal.aborted) break;
        try {
          await remove(
            id,
            AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
          );
          done.push(id);
        } catch (err) {
          if (controller.signal.aborted) break;
          if (err instanceof ApiError && err.status === 404) done.push(id);
          else {
            conflict ||= err instanceof ApiError && err.status === 409;
            if (err instanceof ApiError && [0, 401, 403].includes(err.status))
              break;
          }
        }
      }
      if (!active.current || controller.signal.aborted) return;
      setSelected((items) => items.filter((id) => !done.includes(id)));
      setConfirming(false);
      if (done.length) {
        setMessage(`${done.length}개 항목의 삭제를 완료했습니다.`);
        onDeleted();
      }
      const remaining = selected.length - done.length;
      if (remaining)
        setError(
          `${remaining}개 항목을 삭제하지 못해 선택을 유지했습니다. ${conflict ? "처리 중인 자료는 작업이 끝난 뒤 삭제해 주세요." : "목록과 연결 상태를 확인한 뒤 다시 시도해 주세요."}`,
        );
    } finally {
      request.current = null;
      if (active.current) setBusy(false);
    }
  }
  return {
    mode,
    selected,
    confirming,
    busy,
    message,
    error,
    exit,
    toggleMode,
    toggle,
    confirmOrDelete,
  };
}
export type ListDeletion = ReturnType<typeof useListDeletion>;

export function ListDeleteActions({
  deletion,
  children,
  onToggle,
}: {
  deletion: ListDeletion;
  children: ReactNode;
  onToggle?: () => void;
}) {
  return (
    <div className="list-actions">
      <div className="list-delete-controls">
        {deletion.mode && (
          <button
            type="button"
            className={deletion.confirming ? "danger" : "danger secondary"}
            disabled={deletion.busy || !deletion.selected.length}
            onClick={() => void deletion.confirmOrDelete()}
          >
            {deletion.busy
              ? "삭제 중…"
              : deletion.confirming
                ? "삭제 확인"
                : "삭제"}
          </button>
        )}
        <button
          type="button"
          className="danger secondary"
          disabled={deletion.busy}
          aria-pressed={deletion.mode}
          onClick={() => {
            deletion.toggleMode();
            onToggle?.();
          }}
        >
          {deletion.mode ? "삭제 모드 해제" : "삭제 모드"}
        </button>
      </div>
      {children}
    </div>
  );
}

export function ListDeleteNotice({
  deletion,
  consequence,
}: {
  deletion: ListDeletion;
  consequence: string;
}) {
  return (
    <>
      {deletion.mode && (
        <div className="notice list-delete-notice" role="status">
          {deletion.selected.length}개 선택 · 항목 어디를 눌러도 선택하거나
          해제할 수 있습니다.
          {deletion.confirming && (
            <p>
              <strong>
                선택한 {deletion.selected.length}개 항목을 삭제할까요?
              </strong>{" "}
              ‘삭제 확인’을 누르면 삭제됩니다. {consequence} 삭제한 항목은
              복구할 수 없습니다.
            </p>
          )}
        </div>
      )}
      {deletion.message && (
        <p className="success" role="status">
          {deletion.message}
        </p>
      )}
      {deletion.error && <ErrorNotice message={deletion.error} />}
    </>
  );
}

export function DeleteSelectable({
  deletion,
  id,
  label,
  className = "",
  children,
}: {
  deletion: ListDeletion;
  id: string;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const checked = deletion.selected.includes(id);
  return (
    <div
      role="checkbox"
      aria-label={`${label} 선택`}
      aria-checked={checked}
      aria-disabled={deletion.busy}
      tabIndex={deletion.busy ? -1 : 0}
      className={`delete-selectable ${checked ? "is-selected" : ""} ${className}`}
      onClick={() => deletion.toggle(id)}
      onKeyDown={(event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          deletion.toggle(id);
        }
      }}
    >
      <span className="delete-select-check" aria-hidden="true">
        {checked ? "✓" : ""}
      </span>
      {children}
    </div>
  );
}
