"use client";
import Link from "next/link";
import { deadlinesApi } from "@/features/deadlines/api";
import { sourcesApi } from "@/features/sources/api";
import { DeadlineRows } from "@/features/deadlines/deadline-list";
import { NewRegistrationLink } from "@/features/deadlines/new-registration-link";
import { useResource } from "@/lib/api/use-resource";
import { Empty, ErrorNotice, Loading } from "@/components/feedback";
import { WorkspaceIcon } from "@/components/workspace-icon";
import { DashboardSchedules } from "@/features/tasks/dashboard-schedules";

const load = async () => {
  const [deadlines, sources] = await Promise.all([
    deadlinesApi.list(),
    sourcesApi.list(),
  ]);
  return { deadlines, sources };
};

export default function DashboardPage() {
  const { data, loading, error, reload } = useResource(load);
  return (
    <div className="dashboard-reference">
      <section
        className="card dashboard-onboarding"
        aria-labelledby="dashboard-start-title"
      >
        <span className="onboarding-badge">3단계로 시작하기</span>
        <h1 id="dashboard-start-title">머릿속 할 일 대신, 눈앞의 계획으로.</h1>
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
      </section>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorNotice message={error} retry={reload} />
      ) : (
        data && (
          <>
            <div className="stats dashboard-stats">
              <Link className="card stat" href="/sources">
                <div>
                  <strong>
                    보관한 자료 {data.sources.length}
                    {data.sources.length === 50 ? "+" : ""}개
                  </strong>
                  <span className="small muted">자료함 보기 ↗</span>
                </div>
                <WorkspaceIcon name="inbox" />
              </Link>
              <Link className="card stat" href="/deadlines">
                <div>
                  <strong>
                    등록한 일정 {data.deadlines.length}
                    {data.deadlines.length === 50 ? "+" : ""}개
                  </strong>
                  <span className="small muted">마감일·할 일 보기 ↗</span>
                </div>
                <WorkspaceIcon name="calendar" />
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
                  공고 링크나 파일을 올리거나 직접 날짜를 입력해 첫 마감일을
                  등록해 보세요.
                  <NewRegistrationLink className="button secondary">
                    첫 일정 등록하기
                  </NewRegistrationLink>
                </Empty>
              )}
            </section>
          </>
        )
      )}
      <DashboardSchedules />
    </div>
  );
}
