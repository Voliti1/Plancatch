"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { ErrorNotice, Loading } from "@/components/feedback";
import { ApiError, errorMessage } from "@/lib/api/client";
import { useHydrated } from "@/lib/use-hydrated";
import { authApi } from "./api";
import { useAuth } from "./provider";

const messages: Record<string, string> = {
  password_recovery_unavailable:
    "지금은 임시 비밀번호 메일을 보낼 수 없습니다. 잠시 후 다시 시도해 주세요.",
  password_recovery_rate_limited:
    "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
  current_password_incorrect: "메일에 있는 임시 비밀번호를 확인해 주세요.",
  new_password_unchanged: "임시 비밀번호와 다른 새 비밀번호를 사용해 주세요.",
};

export function PasswordRecovery({ change = false }: { change?: boolean }) {
  const { user, loading, changePassword, logout } = useAuth();
  const router = useRouter();
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (change && !loading && !user) router.replace("/login");
    if (change && user && !user.password_change_required)
      router.replace("/dashboard");
  }, [change, loading, user, router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      if (change) {
        const next = String(values.get("new_password") ?? "");
        if (next !== values.get("confirmation"))
          throw new Error("새 비밀번호가 일치하지 않습니다.");
        await changePassword(
          String(values.get("current_password") ?? ""),
          next,
        );
      } else {
        await authApi.requestPasswordRecovery(
          String(values.get("email") ?? "").trim(),
        );
        setAccepted(true);
      }
    } catch (cause) {
      setError(
        (cause instanceof ApiError && messages[cause.message]) ||
          errorMessage(cause),
      );
    } finally {
      setBusy(false);
    }
  }

  if (change && (!user?.password_change_required || loading))
    return <Loading />;

  return (
    <main className="auth-panel auth-recovery-panel">
      <section className="auth-card">
        <h1>{change ? "새 비밀번호 설정" : "비밀번호 찾기"}</h1>
        <p className="muted">
          {change
            ? "새 비밀번호를 설정하면 PlanCatch를 이용할 수 있습니다."
            : "가입한 이메일로 15분 동안 사용할 수 있는 임시 비밀번호를 보내드립니다."}
        </p>
        {accepted ? (
          <p className="notice" role="status">
            요청을 받았습니다. 비밀번호로 로그인할 수 있는 계정이라면 가입
            이메일로 안내가 발송됩니다. Google로만 가입했다면 Google 로그인을
            이용해 주세요.
          </p>
        ) : (
          <form onSubmit={submit}>
            <fieldset disabled={busy || !hydrated}>
              {change ? (
                <>
                  <input
                    type="hidden"
                    name="username"
                    autoComplete="username"
                    value={user?.email ?? ""}
                  />
                  <label>
                    임시 비밀번호
                    <input
                      type="password"
                      name="current_password"
                      autoComplete="current-password"
                      required
                      maxLength={128}
                    />
                  </label>
                  <label>
                    새 비밀번호
                    <input
                      type="password"
                      name="new_password"
                      autoComplete="new-password"
                      required
                      minLength={8}
                      maxLength={128}
                    />
                  </label>
                  <label>
                    새 비밀번호 확인
                    <input
                      type="password"
                      name="confirmation"
                      autoComplete="new-password"
                      required
                      minLength={8}
                      maxLength={128}
                    />
                  </label>
                </>
              ) : (
                <label>
                  가입 이메일
                  <input
                    type="email"
                    name="email"
                    autoComplete="email"
                    required
                    maxLength={320}
                  />
                </label>
              )}
              {error && <ErrorNotice message={error} />}
              <button className="full" type="submit">
                {busy
                  ? "처리 중…"
                  : change
                    ? "새 비밀번호 저장"
                    : "임시 비밀번호 받기"}
              </button>
            </fieldset>
          </form>
        )}
        <div className="auth-switch">
          {change ? (
            <button type="button" className="secondary" onClick={logout}>
              로그아웃
            </button>
          ) : (
            <Link href="/login">로그인으로 돌아가기</Link>
          )}
        </div>
      </section>
    </main>
  );
}
