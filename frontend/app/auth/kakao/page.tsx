import type { Metadata } from "next";
import { KakaoCallback } from "@/features/auth/kakao-callback";

export const metadata: Metadata = { referrer: "no-referrer" };

export default function KakaoReturnPage() {
  return <KakaoCallback />;
}
