"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
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
  capacity_risk?: {
    level:
      | "completed"
      | "overdue"
      | "insufficient"
      | "tight"
      | "feasible"
      | "attention"
      | "unknown";
    checked_until: string;
    includes_google: boolean;
    google_state: string;
    working_minutes: number | null;
    free_minutes: number | null;
    reserved_minutes: number | null;
    known_required_minutes: number;
    required_minutes: number | null;
    to_schedule_minutes: number | null;
    prerequisite_count: number;
    incomplete: boolean;
    reasons: string[];
  } | null;
}
const riskLabels = {
  completed: "할 일 완료",
  overdue: "마감 지남",
  insufficient: "시간 부족",
  tight: "여유 적음",
  feasible: "배치 가능",
  attention: "계획 확인",
  unknown: "판단 보류",
};
const riskStyles = {
  completed: "completed",
  overdue: "overdue",
  insufficient: "shortage",
  tight: "attention",
  feasible: "planned",
  attention: "attention",
  unknown: "unknown",
};
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
  const [includeGoogle, setIncludeGoogle] = useState(false);
  const loader = useCallback(
    (signal: AbortSignal) =>
      api<Readiness>(
        `/api/deadlines/${encodeURIComponent(id)}/readiness${includeGoogle ? "?include_google=true" : ""}`,
        {
          signal,
          timeoutMs: includeGoogle ? 30000 : 15000,
        },
      ),
    [id, includeGoogle],
  );
  const { data, loading, error, reload } = useResource(loader);
  const metrics =
    data?.capacity_risk?.working_minutes != null ? data.capacity_risk : null;
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
      <label className="checkbox">
        <input
          type="checkbox"
          checked={includeGoogle}
          onChange={(e) => setIncludeGoogle(e.target.checked)}
        />
        구글 바쁨 일정도 포함해 확인
      </label>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorNotice message={error} retry={reload} />
      ) : (
        data && (
          <>
            <p>
              <strong
                className={`readiness-badge readiness-${data.capacity_risk ? riskStyles[data.capacity_risk.level] : data.status}`}
              >
                {data.capacity_risk
                  ? riskLabels[data.capacity_risk.level]
                  : labels[data.status]}
              </strong>
            </p>
            <p className="small muted">
              {data.uses_safety_deadline ? "안전 마감" : "공식 마감"} 기준 ·{" "}
              {formatSeoul(data.target_at)}
            </p>
            {data.capacity_risk && (
              <p className="small muted">
                {data.capacity_risk.includes_google
                  ? data.capacity_risk.google_state === "checked"
                    ? "구글 바쁨 일정 포함"
                    : data.capacity_risk.google_state === "not_needed"
                      ? "완료 상태 확인"
                      : "구글 일정 확인 필요"
                  : "플랜캐치 일정 기준"}{" "}
                · 확인 범위 {formatSeoul(data.capacity_risk.checked_until)}까지
                {data.capacity_risk.prerequisite_count > 0 &&
                  ` · 선행 작업 ${data.capacity_risk.prerequisite_count}개도 확인했습니다.`}
              </p>
            )}
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
                  {metrics
                    ? metrics.required_minutes === null
                      ? `미정 (확인된 시간 ${duration(metrics.known_required_minutes)})`
                      : duration(metrics.required_minutes)
                    : data.required_minutes === null
                      ? `미정 (확인된 시간 ${duration(data.known_required_minutes)})`
                      : duration(data.required_minutes)}
                </dd>
              </div>
              <div>
                <dt>
                  {metrics ? "목표 전 유효한 배치" : "목표 전 배치한 시간"}
                </dt>
                <dd>
                  {metrics
                    ? metrics.reserved_minutes === null
                      ? "확인 필요"
                      : duration(metrics.reserved_minutes)
                    : duration(data.planned_minutes)}
                </dd>
              </div>
              <div>
                <dt>추가 배치할 시간</dt>
                <dd>
                  {metrics
                    ? metrics.to_schedule_minutes === null
                      ? "정보 확인 필요"
                      : duration(metrics.to_schedule_minutes)
                    : data.unplanned_minutes === null
                      ? "정보 확인 필요"
                      : duration(data.unplanned_minutes)}
                </dd>
              </div>
              {metrics && metrics.level !== "completed" && (
                <div>
                  <dt>추가로 쓸 수 있는 빈 시간</dt>
                  <dd>
                    {metrics.free_minutes === null
                      ? "확인 필요"
                      : duration(metrics.free_minutes)}
                  </dd>
                </div>
              )}
            </dl>
            <ul>
              {(data.capacity_risk?.reasons ?? data.reasons).map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <details className="readiness-method">
              <summary>계산 기준</summary>
              <p className="small muted">
                {data.capacity_risk ? (
                  "저장한 가능 시간·휴무일에서 고정·반복 일정과 확정 배치를 뺀 뒤, 필요한 선행 작업과 각 완료 기한을 확인합니다. 완료 표시하지 않은 작업은 지난 배치만으로 완료로 보지 않습니다. 다른 마감일의 미배치 작업은 선행 작업인 경우에만 포함합니다. 결과는 실제 일정 예약이나 성공 확률이 아니며, 일정을 유지한 상태에서 확인한 범위의 판단입니다."
                ) : (
                  <>
                    완료 표시되지 않은 할 일은 전체 예상 시간으로 계산합니다.
                    지난 배치를 작업 완료로 간주하지 않습니다. 배치 시간은
                    소요시간을 확인한 할 일만 계산하며, 다른 작업과 구글 개인
                    일정의 겹침은 이 표시에서 확인하지 않습니다.
                  </>
                )}
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
