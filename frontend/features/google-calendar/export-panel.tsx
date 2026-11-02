"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ErrorNotice } from "@/components/feedback";
import { api, errorMessage } from "@/lib/api/client";
import { formatSeoul } from "@/lib/date/seoul";

type Kind = "deadline" | "task" | "event";
interface Preview {
  title: string;
  start_at: string;
  end_at: string;
  status:
    | "new"
    | "pending"
    | "sent"
    | "conflict"
    | "blocked"
    | "changing"
    | "deleted";
  changed: boolean;
  preview_token: string | null;
  note: string;
  local_available?: boolean;
  pending_action?: "update" | "delete" | null;
}
type Snapshot = { title: string; start_at: string; end_at: string };
type ChangePreview = {
  action: "update" | "delete";
  before: Snapshot;
  after: Snapshot | null;
  state: "ready" | "pending" | "unchanged" | "deleted";
  preview_token: string | null;
  note: string;
};
const prefix = "/api/integrations/google-calendar/exports";

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
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [change, setChange] = useState<ChangePreview | null>(null);
  const [notice, setNotice] = useState("");
  const pending = useRef(false),
    active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function perform(confirm = false) {
    if (pending.current || disabled || (confirm && !preview?.preview_token))
      return;
    pending.current = true;
    setBusy(true);
    setError("");
    setChange(null);
    setNotice("");
    try {
      if (confirm) {
        await api<{ status: "sent" }>(prefix + "/confirm", {
          method: "POST",
          body: JSON.stringify({
            kind,
            item_id: itemId,
            preview_token: preview!.preview_token,
            confirm: true,
          }),
          timeoutMs: 60000,
        });
        if (active.current)
          setPreview((current) =>
            current
              ? { ...current, status: "sent", preview_token: null }
              : null,
          );
      } else {
        const result = await api<Preview>(prefix + "/preview", {
          method: "POST",
          body: JSON.stringify({ kind, item_id: itemId }),
        });
        if (active.current) setPreview(result);
      }
    } catch (err) {
      if (active.current)
        setError(
          errorMessage(err) +
            (confirm
              ? " 전송이 완료됐을 수 있으니 같은 항목의 미리보기를 다시 확인해 주세요."
              : ""),
        );
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function changeGoogle(action: "update" | "delete", confirm = false) {
    if (
      pending.current ||
      disabled ||
      (confirm && (!change?.preview_token || change.action !== action))
    )
      return;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (confirm) {
        await api(prefix + "/change-confirm", {
          method: "POST",
          timeoutMs: 60000,
          body: JSON.stringify({
            kind,
            item_id: itemId,
            action,
            preview_token: change!.preview_token,
            confirm: true,
          }),
        });
        if (active.current) {
          setChange(null);
          setNotice(
            action === "update"
              ? "Google 일정에 수정 내용을 반영했습니다."
              : "Google 일정을 삭제했습니다. 플랜캐치 자료는 유지됩니다.",
          );
          setPreview(null);
          onChanged?.();
        }
      } else {
        setChange(null);
        const result = await api<ChangePreview>(prefix + "/change-preview", {
          method: "POST",
          timeoutMs: 60000,
          body: JSON.stringify({ kind, item_id: itemId, action }),
        });
        if (active.current) setChange(result);
      }
    } catch (err) {
      if (active.current)
        setError(
          errorMessage(err) +
            (confirm ? " 같은 변경의 미리보기를 다시 확인해 주세요." : ""),
        );
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <section
      className="card form-card google-export-panel"
      aria-label="Google 일정 전송"
    >
      <h2>Google 캘린더로 보내기</h2>
      <p className="muted small">
        내용을 확인한 뒤 전송합니다. 플랜캐치에서 수정한 내용은 아래에서 다시
        확인해 Google에 반영할 수 있습니다. Google 삭제는 플랜캐치 자료를 지우지
        않습니다.
      </p>
      <button
        type="button"
        className="secondary"
        disabled={busy || disabled}
        onClick={() => void perform()}
      >
        {busy
          ? "전송 상태 확인 중…"
          : preview
            ? "전송 미리보기 다시 확인"
            : "Google 전송 미리보기"}
      </button>
      {preview && (
        <div className="notice" role="group" aria-label="Google 전송 내용 확인">
          <h3>{preview.title}</h3>
          <p>
            시작: {formatSeoul(preview.start_at)}
            <br />
            종료: {formatSeoul(preview.end_at)}
            <br />
            대상: 현재 연결된 Google 기본 캘린더 · 한국 시간
          </p>
          <p className="small">{preview.note}</p>
          {preview.status === "deleted" ? (
            <p className="success" role="status">
              Google 삭제 완료 · 같은 항목을 다시 만들지 않습니다.
            </p>
          ) : preview.status === "sent" ? (
            <p className="success" role="status">
              Google 등록 완료 · 같은 항목은 다시 생성하지 않습니다.
            </p>
          ) : preview.preview_token ? (
            <button
              type="button"
              disabled={busy || disabled}
              onClick={() => void perform(true)}
            >
              {busy
                ? "전송 확인 중…"
                : preview.status === "pending"
                  ? "같은 전송 확인·재시도"
                  : "확인 후 Google에 등록"}
            </button>
          ) : (
            <p role="status">
              중복 또는 충돌 방지를 위해 전송하지 않습니다. Google 캘린더에서
              확인해 주세요.
            </p>
          )}
          {["sent", "conflict", "changing"].includes(preview.status) && (
            <div className="actions">
              {preview.local_available !== false &&
                preview.pending_action !== "delete" && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || disabled}
                    onClick={() => void changeGoogle("update")}
                  >
                    Google 수정 미리보기
                  </button>
                )}
              {preview.pending_action !== "update" && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy || disabled}
                  onClick={() => void changeGoogle("delete")}
                >
                  Google 삭제 미리보기
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {change && (
        <section
          className="notice"
          role="group"
          aria-label="Google 변경 내용 확인"
        >
          <h3>
            {change.action === "update"
              ? "Google 일정 수정"
              : "Google 일정 삭제"}
          </h3>
          <p>
            <strong>{change.before.title}</strong>
            <br />
            기존: {formatSeoul(change.before.start_at)} ~{" "}
            {formatSeoul(change.before.end_at)}
          </p>
          {change.after && (
            <p>
              <strong>{change.after.title}</strong>
              <br />
              변경: {formatSeoul(change.after.start_at)} ~{" "}
              {formatSeoul(change.after.end_at)}
            </p>
          )}
          <p>{change.note}</p>
          {change.preview_token && (
            <div className="actions">
              <button
                type="button"
                className={
                  change.action === "delete" ? "google-delete-confirm" : ""
                }
                disabled={busy || disabled}
                onClick={() => void changeGoogle(change.action, true)}
              >
                {busy
                  ? "결과 확인 중…"
                  : change.state === "pending"
                    ? "같은 변경 확인·재시도"
                    : change.action === "update"
                      ? "확인 후 Google에 수정 반영"
                      : "Google 일정 삭제 확인"}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy || disabled}
                onClick={() => setChange(null)}
              >
                닫기
              </button>
            </div>
          )}
          <button
            type="button"
            className="secondary"
            disabled={busy || disabled}
            onClick={() => void changeGoogle(change.action)}
          >
            변경 미리보기 다시 확인
          </button>
        </section>
      )}
      {notice && (
        <p role="status" className="notice success">
          {notice}
        </p>
      )}
      {error && <ErrorNotice message={error} />}
      <p className="small">
        <Link href="/settings/google-calendar">Google 계정 연결 확인 →</Link>
      </p>
    </section>
  );
}
