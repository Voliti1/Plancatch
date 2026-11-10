"use client";

import Link from "next/link";
import { useCallback } from "react";
import { ErrorNotice, Loading } from "@/components/feedback";
import { api } from "@/lib/api/client";
import { useResource } from "@/lib/api/use-resource";
import { formatSeoul } from "@/lib/date/seoul";
import "./deadline-readiness.css";

type ReadinessStatus =
  "overdue" | "shortage" | "attention" | "unknown" | "planned" | "completed";
interface Readiness {
  assessed_at: string;
  target_at: string;
  uses_safety_deadline: boolean;
  status: ReadinessStatus;
  reasons: string[];
  task_count: number;
  completed_count: number;
  known_required_minutes: number;
  required_minutes: number | null;
  planned_minutes: number;
  unplanned_minutes: number | null;
  truncated: boolean;
}
const labels: Record<ReadinessStatus, string> = {
  overdue: "마감 지남",
  shortage: "시간 부족",
  attention: "확인 필요",
  unknown: "정보 부족",
  planned: "계획 있음",
  completed: "할 일 완료",
};
function duration(value: number) {
  return value >= 60
    ? `${Math.floor(value / 60)}시간${value % 60 ? ` ${value % 60}분` : ""}`
    : `${value}분`;
}
export function DeadlineReadiness({ id }: { id: string }) {
  const loader = useCallback(
    (signal: AbortSignal) =>
      api<Readiness>(`/api/deadlines/${encodeURIComponent(id)}/readiness`, {
        signal,
      }),
    [id],
  );
  const { data, loading, error, reload } = useResource(loader);
  return (
    <section className="card deadline-readiness" aria-label="마감 준비 상태">
      <div className="section-header">
        <h2>마감 준비 상태</h2>
        <button
          type="button"
          className="secondary"
          onClick={reload}
          disabled={loading}
        >
          다시 확인
        </button>
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorNotice message={error} retry={reload} />
      ) : (
        data && (
          <>
            <p>
              <strong className={`readiness-badge readiness-${data.status}`}>
                {labels[data.status]}
              </strong>
            </p>
            <p className="small muted">
              {data.uses_safety_deadline ? "안전 마감" : "공식 마감"} 기준 ·{" "}
              {formatSeoul(data.target_at)}
            </p>
            <dl className="readiness-summary">
              <div>
                <dt>완료한 할 일{data.truncated ? " (확인한 항목)" : ""}</dt>
                <dd>
                  {data.completed_count} / {data.task_count}개
                </dd>
              </div>
              <div>
                <dt>미완료 작업 예상 시간</dt>
                <dd>
                  {data.required_minutes === null
                    ? `미정 (확인된 시간 ${duration(data.known_required_minutes)})`
                    : duration(data.required_minutes)}
                </dd>
              </div>
              <div>
                <dt>목표 전 배치한 시간</dt>
                <dd>{duration(data.planned_minutes)}</dd>
              </div>
              <div>
                <dt>추가 배치할 시간</dt>
                <dd>
                  {data.unplanned_minutes === null
                    ? "정보 확인 필요"
                    : duration(data.unplanned_minutes)}
                </dd>
              </div>
            </dl>
            <ul>
              {data.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <details className="readiness-method">
              <summary>계산 기준</summary>
              <p className="small muted">
                완료 표시되지 않은 할 일은 전체 예상 시간으로 계산합니다. 지난
                배치를 작업 완료로 간주하지 않습니다. 배치 시간은 소요시간을
                확인한 할 일만 계산하며, 다른 작업과 구글 개인 일정의 겹침은 이
                표시에서 확인하지 않습니다.
              </p>
            </details>
            <div className="readiness-footer">
              <span className="small muted">
                확인 시각 {formatSeoul(data.assessed_at)}
              </span>
              <Link href="/planning">자동 배치로 시간 확인 →</Link>
            </div>
          </>
        )
      )}
    </section>
  );
}
