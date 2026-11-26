"use client";

import { useEffect, useRef, useState } from "react";
import { ErrorNotice, Loading } from "@/components/feedback";
import { errorMessage } from "@/lib/api/client";
import { useResource } from "@/lib/api/use-resource";
import { checkedGoogleAuthorizationUrl, googleCalendarApi } from "./api";
import { ManagedExports } from "./managed-exports";
import "./connection-page.css";

export function GoogleCalendarConnection() {
  const status = useResource(googleCalendarApi.status);
  const { reload } = status;
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [managing, setManaging] = useState(false);
  const active = useRef(false);
  const operating = useRef(false);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const disconnectButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    function refresh() {
      if (!operating.current && document.visibilityState === "visible")
        reload();
    }
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [reload]);
  useEffect(() => {
    if (confirming) confirmButton.current?.focus();
  }, [confirming]);

  async function connect() {
    if (operating.current) return;
    operating.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await googleCalendarApi.connect();
      if (active.current)
        window.location.assign(
          checkedGoogleAuthorizationUrl(response.authorization_url),
        );
    } catch (failure) {
      if (active.current) setError(errorMessage(failure));
    } finally {
      operating.current = false;
      if (active.current) setBusy(false);
    }
  }

  async function disconnect() {
    if (operating.current) return;
    operating.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await googleCalendarApi.disconnect();
      if (active.current) {
        setConfirming(false);
        setNotice(
          response.manual_revoke_required
            ? "플랜캐치 연결을 끊었어요. 구글 쪽 연결 해제는 확인하지 못했어요. 구글 계정의 연결 관리에서도 플랜캐치를 해제해 주세요."
            : "구글 캘린더 연결을 해제했어요. 기존 일정은 변경하지 않았어요.",
        );
        status.reload();
      }
    } catch (failure) {
      if (active.current) setError(errorMessage(failure));
    } finally {
      operating.current = false;
      if (active.current) setBusy(false);
    }
  }

  return (
    <>
      <section
        id="google"
        className="card form-card"
        aria-label="구글 계정 연결 설정"
      >
        <h2>구글 캘린더 연결</h2>
        <p className="muted">
          구글 계정을 연결하면 이후 플랜캐치에서 등록·수정·삭제하는 일정이 구글
          캘린더에 자동으로 반영돼요. 다른 앱에서 만든 구글 캘린더 일정은
          변경하지 않아요.
        </p>
        {status.loading && <Loading />}
        {status.error && (
          <ErrorNotice message={status.error} retry={status.reload} />
        )}
        {error && <ErrorNotice message={error} />}
        {notice && (
          <div className="notice" role="status">
            <p>{notice}</p>
            <a
              href="https://myaccount.google.com/connections"
              target="_blank"
              rel="noopener noreferrer"
            >
              구글 계정 연결 관리 ↗
            </a>
          </div>
        )}
        {status.data && (
          <>
            <div className="notice" role="status">
              <strong>
                {!status.data.configured
                  ? "서버 연결 설정이 필요해요"
                  : status.data.reconnect_required
                    ? "재연결이 필요해요"
                    : status.data.connected
                      ? "구글 캘린더 연결됨"
                      : status.data.pending
                        ? "구글 계정 확인 진행 중"
                        : "아직 연결하지 않았어요"}
              </strong>
              <p>
                {status.data.connected
                  ? "저장된 연결 정보를 확인했어요. 구글 캘린더에서 직접 권한을 취소했다면 재연결이 필요할 수 있어요."
                  : "연결 버튼을 누른 뒤 구글 캘린더에서 계정과 캘린더 권한을 직접 승인해 주세요."}
              </p>
            </div>
            <div className="google-calendar-connection-actions">
              {status.data.configured && (
                <button
                  disabled={busy || confirming}
                  onClick={() => void connect()}
                >
                  {busy
                    ? "처리 중…"
                    : status.data.connected ||
                        status.data.reconnect_required ||
                        status.data.pending
                      ? "구글 계정 다시 연결"
                      : "구글 계정 연결"}
                </button>
              )}
              {(status.data.connected ||
                status.data.reconnect_required ||
                status.data.pending) && (
                <button
                  className="secondary"
                  ref={disconnectButton}
                  disabled={busy || confirming}
                  onClick={() => setConfirming(true)}
                >
                  연결 해제
                </button>
              )}
              <button
                className="secondary"
                disabled={busy || confirming}
                onClick={status.reload}
              >
                상태 다시 확인
              </button>
              {status.data.connected && (
                <button
                  className="secondary"
                  disabled={busy || confirming}
                  onClick={() => setManaging((value) => !value)}
                >
                  {managing ? "보낸 일정 관리 닫기" : "보낸 일정 관리"}
                </button>
              )}
            </div>
          </>
        )}
        {confirming && (
          <section
            className="notice"
            role="alertdialog"
            aria-labelledby="google-disconnect-title"
            aria-describedby="google-disconnect-detail"
          >
            <h3 id="google-disconnect-title">구글 연결을 해제할까요?</h3>
            <p id="google-disconnect-detail">
              플랜캐치와 구글 캘린더 연결을 끊어요. 이미 구글 캘린더에 등록한
              일정은 지워지지 않아요. 같은 구글 계정으로 연결한 다른 플랜캐치
              서비스도 다시 연결해야 할 수 있어요.
            </p>
            <div className="actions">
              <button
                ref={confirmButton}
                disabled={busy}
                onClick={() => void disconnect()}
              >
                연결 해제 확인
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  setConfirming(false);
                  disconnectButton.current?.focus();
                }}
              >
                취소
              </button>
            </div>
          </section>
        )}
      </section>
      {status.data?.connected && managing && (
        <ManagedExports key={status.data.connected_at} />
      )}
    </>
  );
}
