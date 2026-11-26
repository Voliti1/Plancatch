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
        description="공고나 안내문을 올리면 마감일을 찾아 주고, 캘린더에 실행 시간까지 정리해 드려요."
      />
      <section className="hero">
        <div>
          <span className="eyebrow">3단계로 시작하기</span>
          <h2>
            머릿속 할 일 대신,
            <br />
            눈앞의 계획으로.
          </h2>
          <ol className="dashboard-flow" aria-label="플랜캐치 이용 순서">
            <li>
              <span>1</span>공고·안내문 올리기
            </li>
            <li>
              <span>2</span>마감일 확인 후 등록
            </li>
            <li>
              <span>3</span>캘린더에 시간 잡기
            </li>
          </ol>
          <div className="hero-actions">
            <NewRegistrationLink className="button">
              새 일정 등록하기 ↗
            </NewRegistrationLink>
            <Link className="button secondary" href="/calendar">
              캘린더 보기
            </Link>
          </div>
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
                <span>보관한 자료</span>
                <strong>
                  {data.sources.length}
                  {data.sources.length === 50 ? "+" : ""}
                  <small>개</small>
                </strong>
                <span className="small muted">자료함 보기 ↗</span>
              </Link>
              <Link className="card stat" href="/deadlines">
                <span>등록한 마감일</span>
                <strong>
                  {data.deadlines.length}
                  {data.deadlines.length === 50 ? "+" : ""}
                  <small>개</small>
                </strong>
                <span className="small muted">마감일·할 일 보기 ↗</span>
              </Link>
            </div>
            <section className="card">
              <div className="section-header">
                <div>
                  <h2>다가오는 마감일</h2>
                  <p className="small muted dashboard-caption">
                    최근 등록한 50건 기준 요약입니다.
                  </p>
                </div>
                <Link href="/deadlines">전체 보기 →</Link>
              </div>
              {data.deadlines.length ? (
                <DeadlineRows deadlines={data.deadlines.slice(0, 5)} />
              ) : (
                <Empty title="아직 등록된 마감일이 없어요">
                  <p>
                    공고 링크나 파일을 올리거나 직접 날짜를 입력해 첫 마감일을
                    등록해 보세요.
                  </p>
                  <NewRegistrationLink className="button secondary">
                    첫 일정 등록하기
                  </NewRegistrationLink>
                </Empty>
              )}
            </section>
          </>
        )
      )}
    </>
  );
}
