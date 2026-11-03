/** A single-sheet checklist matching the workspace's existing outline icons. */
export function TaskListIcon() {
  return (
    <svg
      width="35"
      height="35"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="task-list-icon"
    >
      <rect x="3" y="2" width="18" height="20" rx="3" />
      <path d="m6.5 7 1.2 1.3 2.1-2.4M12.5 7H17.5m-11 5 1.2 1.3 2.1-2.4M12.5 12H17.5m-11 5 1.2 1.3 2.1-2.4M12.5 17H17.5" />
    </svg>
  );
}
