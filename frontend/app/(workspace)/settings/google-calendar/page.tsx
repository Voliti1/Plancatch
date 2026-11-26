import { redirect } from "next/navigation";

export default function LegacyGoogleCalendarPage() {
  redirect("/settings/connections#google");
}
