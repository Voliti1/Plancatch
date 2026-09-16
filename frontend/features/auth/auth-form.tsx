"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "./provider";
import { authApi } from "./api";
import { errorMessage } from "@/lib/api/client";
import { ErrorNotice } from "@/components/feedback";
import { useHydrated } from "@/lib/use-hydrated";
export function AuthForm({ signup = false }: { signup?: boolean }) {
  const hydrated = useHydrated();
  const { user, login } = useAuth();
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [name, setName] = useState("");
  useEffect(() => {
    if (user) router.replace("/dashboard");
  }, [user, router]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (signup) {
        if (password !== confirmation)
          throw new Error("비밀번호가 일치하지 않습니다.");
        await authApi.signup({
          email: email.trim(),
          password,
          display_name: name.trim() || undefined,
        });
        setRegistered(true);
      } else {
        await login(email.trim(), password);
        router.replace("/dashboard");
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-story">
        <Link className="brand" href="/login">
          <span className="logo">P</span>PlanCatch.
        </Link>
        <div>
          <span className="eyebrow">LESS CHAOS, MORE CLARITY</span>
          <h1>
            흩어진 계획을 모아,
            <br />
            나만의 페이스로.
          </h1>
          <p>
            중요한 자료부터 다가오는 마감까지.
            <br />
            기억해야 할 일들을 한곳에 담아 보세요.
          </p>
          <div className="story-card">
            <span>YOUR NEXT STEP</span>
            <h2>
              작은 시작이
              <br />
              여유로운 내일로.
            </h2>
            <div className="story-line" />
            <small>자료 수집 → 마감 확인 → 계획 정리</small>
          </div>
        </div>
        <small>계획을 모으고, 마감을 지키다.</small>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <span className="eyebrow">LET’S GET STARTED</span>
          <h1>{signup ? "회원가입" : "다시 만나 반가워요"}</h1>
          <p className="muted">
            {signup
              ? "PlanCatch와 함께 계획을 시작하세요."
              : "로그인하고 오늘의 계획을 이어가세요."}
          </p>
          {registered ? (
            <div className="notice" role="status">
              <h2>가입이 완료되었습니다.</h2>
              <p>등록한 이메일로 로그인해 주세요.</p>
              <Link className="button" href="/login">
                로그인으로 이동
              </Link>
            </div>
          ) : (
            <form onSubmit={submit}>
              <fieldset disabled={busy || !hydrated}>
                {signup && (
                  <label>
                    이름 (선택)
                    <input
                      name="name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      autoComplete="name"
                      maxLength={100}
                      placeholder="어떻게 불러드릴까요?"
                    />
                  </label>
                )}
                <label>
                  이메일
                  <input
                    name="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="you@example.com"
                  />
                </label>
                <label>
                  비밀번호
                  <input
                    name="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    type="password"
                    autoComplete={signup ? "new-password" : "current-password"}
                    required
                    minLength={signup ? 8 : 1}
                    maxLength={128}
                    placeholder={
                      signup
                        ? "8자 이상 입력해 주세요"
                        : "비밀번호를 입력해 주세요"
                    }
                  />
                </label>
                {signup && (
                  <label>
                    비밀번호 확인
                    <input
                      name="confirm"
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={8}
                      maxLength={128}
                    />
                  </label>
                )}
                {error && <ErrorNotice message={error} />}
                <button className="full" type="submit">
                  {busy ? "처리 중…" : signup ? "계정 만들기 →" : "로그인 →"}
                </button>
              </fieldset>
            </form>
          )}
          <p className="auth-switch">
            {signup ? "이미 계정이 있으신가요?" : "아직 계정이 없으신가요?"}{" "}
            <Link href={signup ? "/login" : "/signup"}>
              {signup ? "로그인" : "회원가입"}
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
