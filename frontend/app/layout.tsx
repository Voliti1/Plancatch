import type { Metadata } from "next";
import { AuthProvider } from "@/features/auth/provider";
import "./globals.css";
import "./theme.css";
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
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{document.documentElement.dataset.theme=localStorage.getItem("plancatch.theme")==="dark"?"dark":"light"}catch{document.documentElement.dataset.theme="light"}`,
          }}
        />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
