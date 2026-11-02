"use client";
import { useSyncExternalStore } from "react";

const key = "plancatch.theme";
const event = "plancatch:theme";
function snapshot() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}
function subscribe(callback: () => void) {
  function storage(changed: StorageEvent) {
    if (changed.key !== key && changed.key !== null) return;
    document.documentElement.dataset.theme =
      changed.newValue === "dark" ? "dark" : "light";
    callback();
  }
  window.addEventListener(event, callback);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(event, callback);
    window.removeEventListener("storage", storage);
  };
}
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, snapshot, () => "light");
  const label = theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환";
  return (
    <button
      type="button"
      className="account-icon"
      aria-label={label}
      title={label}
      onClick={() => {
        const next = theme === "dark" ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem(key, next);
        } catch {
          /* Works without browser storage. */
        }
        window.dispatchEvent(new Event(event));
      }}
    >
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden="true"
      >
        {theme === "dark" ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
          </>
        ) : (
          <path d="M20.7 13.3A9 9 0 0 1 10.7 3.2a9 9 0 1 0 10 10.1Z" />
        )}
      </svg>
    </button>
  );
}
