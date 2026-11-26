"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ErrorNotice } from "@/components/feedback";
import { useAuth } from "./provider";
import { kakaoApi, kakaoMessage, kakaoModeKey } from "./kakao-api";

export function KakaoCallback() {
  const { loginKakao, loading, user } = useAuth();
  const router = useRouter();
  const started = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (started.current || loading) return;
    started.current = true;
    async function finish() {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const mode = sessionStorage.getItem(kakaoModeKey);
        sessionStorage.removeItem(kakaoModeKey);
        window.history.replaceState(window.history.state, "", url.pathname);
        if (
          !code ||
          !state ||
          (mode !== "account" && mode !== "calendar" && mode !== "login")
        )
          throw new Error("kakao_expired");
        if (mode === "login") {
          await loginKakao(code, state);
          router.replace("/dashboard");
        } else {
          if (!user) throw new Error("kakao_expired");
          await kakaoApi.complete(mode, code, state);
          setNotice(
            mode === "calendar"
              ? "카카오 캘린더를 연결했습니다."
              : "카카오 로그인 계정을 연결했습니다.",
          );
        }
      } catch (failure) {
        setError(kakaoMessage(failure));
      }
    }
    void finish();
  }, [loading, loginKakao, router, user]);

  return (
    <main className="auth-panel auth-recovery-panel">
      <section className="auth-card">
        <h1>카카오 연결</h1>
        {error ? (
          <ErrorNotice message={error} />
        ) : (
          <p role="status">{notice || "카카오 계정을 확인하고 있습니다…"}</p>
        )}
        {(error || notice) && (
          <Link
            className="button secondary"
            href={user ? "/dashboard" : "/login"}
          >
            {user ? "대시보드로 돌아가기" : "로그인으로 돌아가기"}
          </Link>
        )}
      </section>
    </main>
  );
}
