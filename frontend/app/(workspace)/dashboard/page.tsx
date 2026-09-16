"use client";
import Link from "next/link";
import { useAuth } from "@/features/auth/provider";
import { deadlinesApi } from "@/features/deadlines/api";
import { sourcesApi } from "@/features/sources/api";
import { DeadlineRows } from "@/features/deadlines/deadline-list";
import { useResource } from "@/lib/api/use-resource";
import { Empty, ErrorNotice, Loading } from "@/components/feedback";
import { PageHeading } from "@/components/page-heading";
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
        eyebrow="YOUR PLANNING SPACE"
        title={`${user?.display_name || "사용자"}님, 오늘도 차근차근.`}
        description="흩어진 자료는 모으고, 중요한 마감은 놓치지 마세요."
      />
      <section className="hero">
        <div>
          <span className="eyebrow">MAKE ROOM FOR WHAT MATTERS</span>
          <h2>
            머릿속 할 일 대신,
            <br />
            눈앞의 계획으로.
          </h2>
          <p>링크 하나, 메모 한 줄부터 시작해 보세요.</p>
          <Link className="button" href="/sources/new">
            새 자료 등록하기 ↗
          </Link>
        </div>
        <div className="hero-art" aria-hidden>
          <div className="paper paper-back" />
          <div className="paper">
            <span className="paper-label">MY PLAN</span>
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
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorNotice message={error} retry={reload} />
      ) : (
        data && (
          <>
            <div className="stats">
              <Link className="card stat" href="/sources">
                <span>모아 둔 자료</span>
                <strong>
                  {data.sources.length}
                  {data.sources.length === 50 ? "+" : ""}
                  <small>개</small>
                </strong>
                <span className="small muted">원본 자료 확인 ↗</span>
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
              <div className="card stat next-step">
                <span className="tag">NEXT STEP</span>
                <h3>다가올 기능</h3>
                <p className="muted small">
                  AI 분석, 작업 계획, 자동 일정 배치를 준비하고 있어요.
                </p>
              </div>
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
                  마감일 메뉴에서 중요한 일정을 직접 등록해 보세요.
                </Empty>
              )}
            </section>
            <p className="small muted">
              요약은 각 목록의 첫 50건 기준입니다. 전체 자료는 목록에서
              확인하세요.
            </p>
          </>
        )
      )}
    </>
  );
}
