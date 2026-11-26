import { PageHeading } from "@/components/page-heading";
import { GoogleCalendarConnection } from "@/features/google-calendar/connection-page";
import "@/features/settings/connections.css";

export default function AccountConnectionsPage() {
  return (
    <>
      <PageHeading
        eyebrow="CONNECTIONS"
        title="계정 연결 관리"
        description="플랜캐치와 외부 계정의 연결 상태를 확인하세요."
      />
      <div className="settings-calendar-connections">
        <GoogleCalendarConnection />
        <section
          id="kakao"
          className="card form-card"
          aria-labelledby="kakao-connection"
        >
          <h2 id="kakao-connection">카카오 캘린더 연결</h2>
          <p className="muted">
            카카오 계정과 톡캘린더 연결은 추후 지원할 예정이에요.
          </p>
        </section>
      </div>
    </>
  );
}
