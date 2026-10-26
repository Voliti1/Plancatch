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
  status: "new" | "pending" | "sent" | "conflict" | "blocked";
  changed: boolean;
  preview_token: string | null;
  note: string;
}
const prefix = "/api/integrations/google-calendar/exports";

export function GoogleExportPanel({
  kind,
  itemId,
  disabled = false,
}: {
  kind: Kind;
  itemId: string;
  disabled?: boolean;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
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
  async function perform(confirm = false) {
    if (pending.current || disabled || (confirm && !preview?.preview_token))
      return;
    pending.current = true;
    setBusy(true);
    setError("");
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
          signal: AbortSignal.timeout(60000),
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
  return (
    <section
      className="card form-card google-export-panel"
      aria-label="Google 일정 전송"
    >
      <h2>Google 캘린더로 보내기</h2>
      <p className="muted small">
        내용을 확인하고 직접 등록할 때만 전송합니다. 이후 플랜캐치에서
        수정·삭제해도 Google 일정은 자동 변경되지 않습니다.
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
          {preview.status === "sent" ? (
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
        </div>
      )}
      {error && <ErrorNotice message={error} />}
      <p className="small">
        <Link href="/settings/google-calendar">Google 계정 연결 확인 →</Link>
      </p>
    </section>
  );
}
