"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorNotice } from "@/components/feedback";
import { ApiError } from "@/lib/api/client";
import { useTheme } from "@/features/settings/theme";
import { authApi } from "./api";
import { useAuth } from "./provider";
import "./google-login.css";

type GoogleIdentity = {
  initialize(options: {
    client_id: string;
    nonce: string;
    callback: (result: { credential: string }) => void;
  }): void;
  renderButton(
    element: HTMLElement,
    options: {
      type: "icon";
      theme: "outline" | "outline_dark";
      shape: "circle";
      size: "large";
      text: "continue_with";
      locale: "ko";
    },
  ): void;
};

const identity = () =>
  (window as Window & { google?: { accounts?: { id?: GoogleIdentity } } })
    .google?.accounts?.id;

const errors: Record<string, string> = {
  google_account_already_linked:
    "이 이메일에는 이미 다른 Google 계정이 연결되어 있습니다. 기존 방식으로 로그인해 주세요.",
  google_login_password_incorrect: "PlanCatch 비밀번호가 일치하지 않습니다.",
  google_login_expired:
    "Google 로그인 요청이 만료되었습니다. 다시 시도해 주세요.",
  google_login_invalid:
    "Google 로그인을 확인하지 못했습니다. 다시 시도해 주세요.",
  google_login_retry:
    "계정이 변경되었습니다. Google 로그인을 다시 시도해 주세요.",
};

export function GoogleLoginButton({ blocked }: { blocked: boolean }) {
  const { loginGoogle } = useAuth();
  const theme = useTheme();
  const holder = useRef<HTMLDivElement>(null);
  const pending = useRef(false);
  const active = useRef(false);
  const [challenge, setChallenge] = useState<{
    client_id: string;
    nonce: string;
  } | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [credential, setCredential] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(false);

  useEffect(() => {
    active.current = true;
    const request = new AbortController();
    void authApi
      .googleChallenge(request.signal)
      .then((result) => {
        if (!request.signal.aborted && result.client_id && result.nonce)
          setChallenge({ client_id: result.client_id, nonce: result.nonce });
      })
      .catch(() => {});
    return () => {
      active.current = false;
      request.abort();
    };
  }, [attempt]);

  const submit = useCallback(
    async (token: string, password?: string) => {
      if (pending.current || !active.current) return;
      pending.current = true;
      setSubmitting(true);
      setError("");
      try {
        await loginGoogle(token, password);
      } catch (cause) {
        if (!active.current) return;
        if (
          cause instanceof ApiError &&
          cause.message === "google_login_password_required"
        ) {
          setCredential(token);
          return;
        }
        const code = cause instanceof ApiError ? cause.message : "";
        setError(
          errors[code] ??
            "Google 로그인을 완료하지 못했습니다. 다시 시도해 주세요.",
        );
        if (code !== "google_login_password_incorrect") {
          setCredential(null);
          setRetry(true);
        }
      } finally {
        pending.current = false;
        if (active.current) setSubmitting(false);
      }
    },
    [loginGoogle],
  );

  useEffect(() => {
    const api = identity();
    if (!challenge || !sdkReady || !api || retry) return;
    api.initialize({
      ...challenge,
      callback: ({ credential: token }) => void submit(token),
    });
  }, [challenge, sdkReady, retry, submit]);

  useEffect(() => {
    const api = identity();
    const node = holder.current;
    if (!challenge || !sdkReady || !api || !node || retry) return;
    api.renderButton(node, {
      type: "icon",
      theme: theme === "dark" ? "outline_dark" : "outline",
      shape: "circle",
      size: "large",
      text: "continue_with",
      locale: "ko",
    });
    return () => node.replaceChildren();
  }, [challenge, sdkReady, retry, theme]);

  if (!challenge) return null;

  function restart() {
    setCredential(null);
    setError("");
    setRetry(false);
    setChallenge(null);
    if (identity()) setSdkReady(true);
    setAttempt((value) => value + 1);
  }

  return (
    <div className="google-login">
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onReady={() => setSdkReady(true)}
        onError={() => {
          setError("Google 로그인 버튼을 불러오지 못했습니다.");
          setRetry(true);
        }}
      />
      <div
        className="google-login-options"
        hidden={Boolean(credential) || retry || !sdkReady}
      >
        <p className="google-login-divider">간편 로그인</p>
        <div className="social-login-buttons">
          <div
            ref={holder}
            inert={blocked || submitting || Boolean(credential) || retry}
          />
        </div>
      </div>
      {submitting && (
        <p className="small muted" role="status">
          Google 계정을 확인하는 중…
        </p>
      )}
      {error && <ErrorNotice message={error} />}
      {retry && (
        <button type="button" className="secondary" onClick={restart}>
          Google 로그인 다시 시도
        </button>
      )}
      {credential && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const password = new FormData(event.currentTarget).get(
              "google_link_password",
            );
            if (typeof password === "string") void submit(credential, password);
          }}
        >
          <p className="muted">
            같은 이메일의 PlanCatch 계정이 있습니다. 현재 PlanCatch 비밀번호를
            확인하면 Google 계정을 연결할 수 있습니다.
          </p>
          <fieldset disabled={submitting || blocked}>
            <label>
              현재 PlanCatch 비밀번호
              <input
                name="google_link_password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
              />
            </label>
            <button type="submit">Google 계정 연결 후 로그인</button>
            <button type="button" className="secondary" onClick={restart}>
              취소
            </button>
          </fieldset>
        </form>
      )}
    </div>
  );
}
