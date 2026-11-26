import type { ReactNode } from "react";

export type WorkspaceIconName =
  | "dashboard"
  | "calendar"
  | "checklist"
  | "timer"
  | "inbox"
  | "google-calendar"
  | "upload";

const shapes: Record<WorkspaceIconName, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M7 3v4m10-4v4M3 11h18" />
    </>
  ),
  checklist: (
    <>
      <path d="M8 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <rect x="8" y="2" width="8" height="5" rx="1.5" />
      <path d="m8 14 2.5 2.5L16 11" />
    </>
  ),
  timer: (
    <>
      <circle cx="12" cy="14" r="8" />
      <path d="M9 2h6m-3 0v4m6 2 2-2m-8 8 3-4" />
    </>
  ),
  inbox: (
    <>
      <path d="m3 13 3-8h12l3 8v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6Z" />
      <path d="M3 13h5l2 3h4l2-3h5" />
    </>
  ),
  "google-calendar": (
    <>
      <rect x="3" y="4" width="18" height="17" rx="2.5" />
      <path d="M7 2v4m10-4v4M3 10h18m-13 5 3 3 5-5" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V3m-5 5 5-5 5 5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
    </>
  ),
};

export function WorkspaceIcon({
  name,
  className = "",
}: {
  name: WorkspaceIconName;
  className?: string;
}) {
  return (
    <svg
      className={`workspace-icon ${className}`}
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {shapes[name]}
    </svg>
  );
}
