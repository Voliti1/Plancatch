"use client";

import { useEffect, useRef, useState } from "react";
import { PageHeading } from "@/components/page-heading";
import { ErrorNotice, Loading } from "@/components/feedback";
import { errorMessage } from "@/lib/api/client";
import { useResource } from "@/lib/api/use-resource";
import { checkedGoogleAuthorizationUrl, googleCalendarApi } from "./api";

export function GoogleCalendarConnectionPage() {
  const status = useResource(googleCalendarApi.status);
  const { reload } = status;
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
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
            ? "플랜캐치의 연결은 해제했습니다. Google 권한 철회는 확인하지 못했으니 Google 계정의 연결 관리에서도 권한을 해제해 주세요."
            : "Google Calendar 연결을 해제했습니다. 기존 일정은 변경하지 않았습니다.",
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
      <PageHeading
        eyebrow="GOOGLE CALENDAR"
        title="구글 캘린더 연결"
        description="본인의 Google 계정을 플랜캐치에 연결하고 상태를 확인하세요."
      />
      <section className="card form-card" aria-label="구글 계정 연결 설정">
        <h2>Google Calendar 계정</h2>
        <p className="muted">
          지금은 계정 연결만 지원합니다. 연결해도 일정이 자동 등록되거나 기존
          Google 일정이 변경되지 않습니다.
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
              Google 계정 연결 관리 ↗
            </a>
          </div>
        )}
        {status.data && (
          <>
            <div className="notice" role="status">
              <strong>
                {!status.data.configured
                  ? "서버 연결 설정이 필요합니다"
                  : status.data.reconnect_required
                    ? "재연결이 필요합니다"
                    : status.data.connected
                      ? "Google Calendar 연결됨"
                      : status.data.pending
                        ? "Google 인증 진행 중"
                        : "아직 연결하지 않았습니다"}
              </strong>
              <p>
                {status.data.connected
                  ? "저장된 연결 정보를 확인했습니다. Google에서 직접 권한을 취소했다면 재연결이 필요할 수 있습니다."
                  : "연결 버튼을 누른 뒤 Google에서 계정과 캘린더 권한을 직접 승인해 주세요."}
              </p>
            </div>
            <p className="muted">
              연결을 유지하는 인증 정보는 서버에 암호화하여 보관합니다. 구글
              연결은 플랜캐치 로그인과 별개이며, 언제든 해제할 수 있습니다.
            </p>
            <div className="actions">
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
                      ? "Google 계정 다시 연결"
                      : "Google 계정 연결"}
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
              플랜캐치의 연결 정보를 지우고 Google 권한 철회를 요청합니다. 같은
              Google 계정·프로젝트의 다른 연결에도 권한 철회가 영향을 줄 수
              있습니다. 기존 일정은 삭제하지 않습니다.
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
    </>
  );
}
