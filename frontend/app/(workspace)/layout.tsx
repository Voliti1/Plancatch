"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/features/auth/provider";
import { ErrorNotice, Loading } from "@/components/feedback";
const nav = [
  ["/dashboard", "◈", "대시보드"],
  ["/sources", "▤", "원본 자료"],
  ["/deadlines", "◷", "마감일"],
];
export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading, error, logout, refresh } = useAuth();
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    if (!loading && !user && !error) router.replace("/login");
  }, [loading, user, error, router]);
  if (loading) return <Loading />;
  if (error)
    return (
      <main className="auth-card">
        <ErrorNotice message={error} retry={refresh} />
        <button onClick={logout}>로그인으로 돌아가기</button>
      </main>
    );
  if (!user) return <Loading />;
  return (
    <div className="workspace">
      <a className="skip" href="#content">
        본문으로 이동
      </a>
      <aside className="sidebar">
        <Link className="brand" href="/dashboard">
          <span className="logo">P</span>PlanCatch
          <span className="brand-dot">.</span>
        </Link>
        <p className="nav-caption">MY WORKSPACE</p>
        <nav aria-label="주 메뉴">
          {nav.map(([href, icon, label]) => (
            <Link
              key={href}
              href={href}
              aria-current={path.startsWith(href) ? "page" : undefined}
            >
              <span aria-hidden>{icon}</span>
              {label}
            </Link>
          ))}
        </nav>
        <div className="coming">
          <span className="tag">준비 중</span>
          <p>작업 · 자동 일정 · 캘린더</p>
          <small>
            계획의 다음 단계도
            <br />곧 이곳에서 함께해요.
          </small>
        </div>
        <div className="account">
          <strong>{user.display_name || "사용자"}</strong>
          <span>{user.email}</span>
          <button
            className="text-button"
            onClick={() => {
              logout();
              router.replace("/login");
            }}
          >
            로그아웃 ↗
          </button>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <span>차근차근, 오늘의 계획부터.</span>
          <span className="timezone">Asia/Seoul · 한국 시간</span>
        </header>
        <main id="content">{children}</main>
        <footer>PlanCatch · 계획을 모으고, 마감을 지키다.</footer>
      </div>
    </div>
  );
}
