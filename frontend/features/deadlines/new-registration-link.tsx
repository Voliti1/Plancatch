"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

export function NewRegistrationLink({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  const router = useRouter();
  return (
    <Link
      className={className}
      href="/deadlines/auto"
      onNavigate={(event) => {
        event.preventDefault();
        // Remount even when the registration route is already open or preserved.
        // This is only a UI identity and also works on the HTTP demo site.
        const entry = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        router.push(`/deadlines/auto?new=${entry}`);
      }}
    >
      {children}
    </Link>
  );
}
