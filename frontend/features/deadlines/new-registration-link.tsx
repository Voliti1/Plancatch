"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

export function NewRegistrationLink({
  className,
  children,
  href = "/sources/new",
  mode,
}: {
  className: string;
  children: ReactNode;
  href?: "/sources/new" | "/deadlines/auto";
  mode?: "manual";
}) {
  const router = useRouter();
  const destination =
    mode === "manual" && href === "/sources/new" ? `${href}?mode=manual` : href;
  return (
    <Link
      className={className}
      href={destination}
      onNavigate={(event) => {
        event.preventDefault();
        // Remount even when the registration route is already open or preserved.
        // This is only a UI identity and also works on the HTTP demo site.
        const entry = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        router.push(
          `${destination}${destination.includes("?") ? "&" : "?"}new=${entry}`,
        );
      }}
    >
      {children}
    </Link>
  );
}
