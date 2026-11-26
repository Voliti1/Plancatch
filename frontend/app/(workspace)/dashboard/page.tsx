"use client";
import Link from "next/link";
import { useAuth } from "@/features/auth/provider";
import { deadlinesApi } from "@/features/deadlines/api";
import { sourcesApi } from "@/features/sources/api";
import { DeadlineRows } from "@/features/deadlines/deadline-list";
import { NewRegistrationLink } from "@/features/deadlines/new-registration-link";
import { useResource } from "@/lib/api/use-resource";
import { Empty, ErrorNotice, Loading } from "@/components/feedback";
import { PageHeading } from "@/components/page-heading";
import { DashboardSchedules } from "@/features/tasks/dashboard-schedules";
const load = async () => {
  const [deadlines, sources] = await Promise.all([
    deadlinesApi.list(),
    sourcesApi.list(),
  ]);
  return { deadlines, sources };
};
export default function DashboardPage() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useResource(load);
  return (
    <>
      <PageHeading
        eyebrow="나의 일정"
        title={`${user?.display_name || "사용자"}님, 오늘도 차근차근.`}
        description="흩어진 자료는 모으고, 중요한 마감은 놓치지 마세요."
      />
      <section className="hero">
        <div>
          <span className="eyebrow">중요한 일에 집중해 보세요</span>
          <h2>
            머릿속 할 일 대신,
            <br />
            눈앞의 계획으로.
          </h2>
          <p>자료를 올리고 마감일을 확인한 뒤, 캘린더에 시간을 잡아 보세요.</p>
          <NewRegistrationLink className="button">
            새 일정 등록하기 ↗
          </NewRegistrationLink>
        </div>
        <div className="hero-art" aria-hidden>
          <div className="paper paper-back" />
          <div className="paper">
            <span className="paper-label">내 계획</span>
            <div className="paper-check">
              ✓ <span />
            </div>
            <div className="paper-check">
              ✓ <span />
            </div>
            <div className="paper-check">
              ○ <span />
            </div>
            <span className="paper-dot">✦</span>
          </div>
        </div>
      </section>
      <DashboardSchedules />
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorNotice message={error} retry={reload} />
      ) : (
        data && (
          <>
            <div className="stats dashboard-stats">
              <Link className="card stat" href="/sources">
                <span>저장한 자료</span>
                <strong>
                  {data.sources.length}
                  {data.sources.length === 50 ? "+" : ""}
                  <small>개</small>
                </strong>
                <span className="small muted">자료 확인 ↗</span>
              </Link>
              <Link className="card stat" href="/deadlines">
                <span>등록한 마감일</span>
                <strong>
                  {data.deadlines.length}
                  {data.deadlines.length === 50 ? "+" : ""}
                  <small>개</small>
                </strong>
                <span className="small muted">마감일 관리 ↗</span>
              </Link>
            </div>
            <section className="card">
              <div className="section-header">
                <h2>마감일 한눈에 보기</h2>
                <Link href="/deadlines">전체 보기 →</Link>
              </div>
              {data.deadlines.length ? (
                <DeadlineRows deadlines={data.deadlines.slice(0, 5)} />
              ) : (
                <Empty title="첫 마감일을 기다리고 있어요">
                  새 일정 등록하기에서 자료를 올리고 마감일을 확인해 보세요.
                </Empty>
              )}
            </section>
            <p className="small muted">
              목록에서 불러온 최대 50건 기준이에요. 전체 내용은 각 목록에서
              확인해 주세요.
            </p>
          </>
        )
      )}
    </>
  );
}
