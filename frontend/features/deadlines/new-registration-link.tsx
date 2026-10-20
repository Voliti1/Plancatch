"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

export function NewRegistrationLink({
  className,
  children,
  href = "/sources/new",
}: {
  className: string;
  children: ReactNode;
  href?: "/sources/new" | "/deadlines/auto";
}) {
  const router = useRouter();
  return (
    <Link
      className={className}
      href={href}
      onNavigate={(event) => {
        event.preventDefault();
        // Remount even when the registration route is already open or preserved.
        // This is only a UI identity and also works on the HTTP demo site.
        const entry = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        router.push(`${href}?new=${entry}`);
      }}
    >
      {children}
    </Link>
  );
}
