"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/features/auth/provider";
import { ErrorNotice, Loading } from "@/components/feedback";
import { NewRegistrationLink } from "@/features/deadlines/new-registration-link";
import { TimeZoneControl, useTimeZone } from "@/features/settings/time-zone";
import { AccountControls } from "@/features/settings/account-controls";
import { useUnsavedNavigation } from "@/lib/unsaved-changes";
const nav = [
  ["/dashboard", "◈", "대시보드"],
  ["/sources", "▤", "자료함"],
  ["/deadlines", "◷", "마감일·할 일"],
  ["/calendar", "▦", "캘린더"],
  ["/planning", "▥", "자동 시간 추천"],
  ["/settings/connections", "↗", "계정 연결 관리"],
];
export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading, error, logout, refresh } = useAuth();
  const zone = useTimeZone();
  const router = useRouter();
  const path = usePathname();
  const { confirmLeave } = useUnsavedNavigation();
  const isNewRegistration = path === "/sources/new";
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
          <span className="logo">P</span>플랜캐치
          <span className="brand-dot">.</span>
        </Link>
        <NewRegistrationLink className="sidebar-new-registration">
          새 일정 등록하기
        </NewRegistrationLink>
        <p className="nav-caption">내 메뉴</p>
        <nav aria-label="주 메뉴">
          {nav.map(([href, icon, label]) => (
            <Link
              key={href}
              href={href}
              aria-current={
                !isNewRegistration &&
                (path.startsWith(href) ||
                  (href === "/sources" && path.startsWith("/analyses/")) ||
                  (href === "/deadlines" && path.startsWith("/tasks")))
                  ? "page"
                  : undefined
              }
            >
              <span aria-hidden>{icon}</span>
              {label}
            </Link>
          ))}
        </nav>
        <div className="account">
          <AccountControls
            name={user.display_name || "사용자"}
            email={user.email}
          />
          <span>{user.email}</span>
          <button
            className="text-button"
            onClick={() => {
              if (!confirmLeave()) return;
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
          <TimeZoneControl />
        </header>
        <main id="content" key={zone}>
          {children}
        </main>
        <footer>플랜캐치 · 계획을 모으고, 마감을 지키다.</footer>
      </div>
    </div>
  );
}
