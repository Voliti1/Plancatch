"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { useAuth } from "@/features/auth/provider";
import { ErrorNotice, Loading } from "@/components/feedback";
import { NewRegistrationLink } from "@/features/deadlines/new-registration-link";
import { TimeZoneControl, useTimeZone } from "@/features/settings/time-zone";
import { AccountControls } from "@/features/settings/account-controls";
import { useUnsavedNavigation } from "@/lib/unsaved-changes";
import { WorkspaceIcon } from "@/components/workspace-icon";
import "./workspace-reference.css";

const navGroups = [
  {
    label: "홈",
    items: [["/dashboard", "dashboard", "대시보드"]] as const,
  },
  {
    label: "일정 관리",
    items: [
      ["/calendar", "calendar", "캘린더"],
      ["/deadlines", "checklist", "마감일·할 일"],
      ["/planning", "timer", "자동 시간 추천"],
    ] as const,
  },
  {
    label: "자료 및 연동",
    items: [
      ["/sources", "inbox", "자료함"],
      ["/settings/google-calendar", "google-calendar", "구글 캘린더"],
    ] as const,
  },
];

function isCurrent(href: string, path: string) {
  return (
    path !== "/sources/new" &&
    (path.startsWith(href) ||
      (href === "/sources" && path.startsWith("/analyses/")) ||
      (href === "/settings/google-calendar" &&
        path.startsWith("/settings/connections")) ||
      (href === "/deadlines" && path.startsWith("/tasks")))
  );
}

function MobileMore({
  path,
  onLogout,
}: {
  path: string;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !container.current?.contains(event.target)
      )
        setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return (
    <div
      className="mobile-more"
      ref={container}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          setOpen(false);
          button.current?.focus();
        }
      }}
    >
      <button
        ref={button}
        type="button"
        className="account-icon"
        aria-label="더보기"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <WorkspaceIcon name="more" />
      </button>
      <div
        id={panelId}
        className="mobile-more-panel"
        hidden={!open}
        role="group"
        aria-label="추가 메뉴"
      >
        <Link
          href="/planning"
          aria-current={isCurrent("/planning", path) ? "page" : undefined}
        >
          <WorkspaceIcon name="timer" />
          자동 시간 추천
        </Link>
        <Link
          href="/settings/google-calendar"
          aria-current={
            isCurrent("/settings/google-calendar", path) ? "page" : undefined
          }
        >
          <WorkspaceIcon name="google-calendar" />
          구글 캘린더
        </Link>
        <button type="button" className="text-button" onClick={onLogout}>
          로그아웃 ↗
        </button>
      </div>
    </div>
  );
}

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
  function exit() {
    if (!confirmLeave()) return;
    logout();
    router.replace("/login");
  }
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
        <NewRegistrationLink className="sidebar-new-registration">
          + 새 일정 등록하기
        </NewRegistrationLink>
        <nav aria-label="주 메뉴">
          {navGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <p className="nav-group-label">{group.label}</p>
              {group.items.map(([href, icon, label]) => (
                <Link
                  key={href}
                  href={href}
                  aria-current={isCurrent(href, path) ? "page" : undefined}
                >
                  <WorkspaceIcon name={icon} />
                  {label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="account">
          <AccountControls
            name={user.display_name || "사용자"}
            email={user.email}
          />
          <span>{user.email}</span>
          <button className="text-button" onClick={exit}>
            로그아웃 ↗
          </button>
          <MobileMore key={path} path={path} onLogout={exit} />
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
      <nav className="mobile-tabbar" aria-label="주 메뉴">
        <Link
          href="/dashboard"
          aria-current={isCurrent("/dashboard", path) ? "page" : undefined}
        >
          <WorkspaceIcon name="dashboard" />
          <span>대시보드</span>
        </Link>
        <Link
          href="/calendar"
          aria-current={isCurrent("/calendar", path) ? "page" : undefined}
        >
          <WorkspaceIcon name="calendar" />
          <span>캘린더</span>
        </Link>
        <NewRegistrationLink
          className="mobile-tabbar-registration"
          aria-label="+ 새 일정 등록하기"
          aria-current={isNewRegistration ? "page" : undefined}
        >
          <WorkspaceIcon name="plus" />
          <span>등록</span>
        </NewRegistrationLink>
        <Link
          href="/deadlines"
          aria-label="마감일·할 일"
          aria-current={isCurrent("/deadlines", path) ? "page" : undefined}
        >
          <WorkspaceIcon name="checklist" />
          <span>일정</span>
        </Link>
        <Link
          href="/sources"
          aria-current={isCurrent("/sources", path) ? "page" : undefined}
        >
          <WorkspaceIcon name="inbox" />
          <span>자료함</span>
        </Link>
      </nav>
    </div>
  );
}
