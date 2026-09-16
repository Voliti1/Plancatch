import type { Metadata } from "next";
import { AuthProvider } from "@/features/auth/provider";
import "./globals.css";
export const metadata: Metadata = {
  title: "PlanCatch | 놓치지 않는 마감",
  description: "흩어진 자료와 마감일을 한곳에서 관리하세요.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
