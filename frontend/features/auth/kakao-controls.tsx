"use client";

import Image from "next/image";
import { useState } from "react";
import { ErrorNotice } from "@/components/feedback";
import { useResource } from "@/lib/api/use-resource";
import {
  beginKakao,
  kakaoApi,
  kakaoMessage,
  type KakaoMode,
} from "./kakao-api";

const loginStatus = () => kakaoApi.status("login");
const accountStatus = () => kakaoApi.status("account");
const calendarStatus = () => kakaoApi.status("calendar");

export function KakaoLoginButton({ blocked }: { blocked: boolean }) {
  const config = useResource(loginStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        className="kakao-login-button"
        aria-label="카카오 로그인"
        title={
          config.data?.configured
            ? "카카오 로그인"
            : "카카오 로그인 연결 준비 중"
        }
        disabled={blocked || busy || !config.data?.configured}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await beginKakao("login");
          } catch (failure) {
            setError(kakaoMessage(failure));
            setBusy(false);
          }
        }}
      >
        <Image
          src="/kakao-login-ko.svg"
          alt=""
          width={112}
          height={40}
          unoptimized
        />
      </button>
      {error && <ErrorNotice message={error} />}
    </>
  );
}

export function KakaoSettings() {
  const account = useResource(accountStatus);
  const calendar = useResource(calendarStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [calendars, setCalendars] = useState<
    { id: string; name: string }[] | null
  >(null);
  async function operate(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (failure) {
      setError(kakaoMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  const start = (mode: KakaoMode) => void operate(() => beginKakao(mode));
  return (
    <div className="settings-calendar-inline">
      {error && <ErrorNotice message={error} />}
      {calendar.error && (
        <ErrorNotice message={calendar.error} retry={calendar.reload} />
      )}
      {account.error && (
        <ErrorNotice message={account.error} retry={account.reload} />
      )}
      <p className="small muted" role="status">
        {calendar.loading
          ? "연결 상태를 확인하는 중…"
          : !calendar.data?.configured
            ? "카카오 캘린더 연결을 준비 중입니다."
            : calendar.data.connected
              ? "카카오 캘린더 연결됨"
              : "연결된 카카오 캘린더가 없습니다."}
      </p>
      <div className="google-calendar-connection-actions">
        {calendar.data?.configured && (
          <button
            type="button"
            disabled={busy}
            onClick={() => start("calendar")}
          >
            {calendar.data.connected
              ? "카카오 캘린더 다시 연결"
              : "카카오 캘린더 연결하기"}
          </button>
        )}
        {calendar.data?.connected && (
          <>
            <button
              type="button"
              className="secondary"
              disabled={busy || !calendar.data.configured}
              onClick={() =>
                void operate(async () =>
                  setCalendars((await kakaoApi.calendars()).calendars),
                )
              }
            >
              캘린더 목록 확인
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() =>
                void operate(async () => {
                  await kakaoApi.disconnect();
                  setCalendars(null);
                  calendar.reload();
                })
              }
            >
              카카오 캘린더 연결 해제
            </button>
          </>
        )}
      </div>
      {calendars &&
        (calendars.length ? (
          <ul>
            {calendars.map((item) => (
              <li key={item.id}>{item.name}</li>
            ))}
          </ul>
        ) : (
          <p>표시할 캘린더가 없습니다.</p>
        ))}
      {account.data?.configured && (
        <div className="kakao-login-connection">
          <p className="small muted">
            {account.data.connected
              ? "카카오 로그인 계정 연결됨"
              : "현재 PlanCatch 계정에 카카오 로그인을 연결할 수 있습니다."}
          </p>
          {!account.data.connected && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => start("account")}
            >
              카카오 로그인 계정 연결
            </button>
          )}
        </div>
      )}
    </div>
  );
}
