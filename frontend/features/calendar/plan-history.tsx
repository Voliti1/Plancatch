"use client";
import Link from "next/link";
import { useCallback, useState } from "react";
import { PageHeading } from "@/components/page-heading";
import { ErrorNotice, Loading } from "@/components/feedback";
import { api } from "@/lib/api/client";
import { useResource } from "@/lib/api/use-resource";
import { formatSeoul } from "@/lib/date/seoul";
import "./auto-schedule.css";

type Cursor = { created_at: string; id: string };
export type SavedState = {
  active_count: number;
  changed_count: number;
  deleted_count: number;
  inactive_count: number;
};
type Entry = {
  id: string;
  created_at: string;
  expires_at: string;
  approved_at: string | null;
  state: "pending" | "approved" | "expired";
  blocked: boolean;
  start_at: string;
  end_at: string;
  task_titles: string[];
  task_count: number;
  block_count: number;
  unplaced_count: number;
  saved_state: SavedState | null;
};
const stateLabels = {
  pending: "검토 가능",
  approved: "저장 완료",
  expired: "유효 시간 지남",
};

export function SavedStateNotice({ state }: { state: SavedState }) {
  return (
    <p className="notice" role="status">
      현재 캘린더에 있는 시간 {state.active_count}개 · 시간 변경{" "}
      {state.changed_count}개 · 삭제 {state.deleted_count}개 · 취소 등 미표시{" "}
      {state.inactive_count}개
    </p>
  );
}

export function PlanHistory() {
  const [state, setState] = useState("all");
  const [cursors, setCursors] = useState<Cursor[]>([]);
  const cursor = cursors.at(-1);
  const load = useCallback(
    (signal: AbortSignal) => {
      const query = new URLSearchParams({ state, limit: "10" });
      if (cursor) {
        query.set("before_at", cursor.created_at);
        query.set("before_id", cursor.id);
      }
      return api<{ entries: Entry[]; next_cursor: Cursor | null }>(
        `/api/scheduling/plans?${query}`,
        { signal },
      );
    },
    [state, cursor],
  );
  const result = useResource(load);
  return (
    <div className="auto-schedule planning-history">
      <PageHeading
        eyebrow="TIME SUGGESTION HISTORY"
        title="시간 추천 기록"
        description="추천받은 시간과 캘린더에 저장한 시간을 다시 확인할 수 있습니다."
        action={
          <Link className="button" href="/planning">
            새 시간 찾기
          </Link>
        }
      />
      <section className="card" aria-label="시간 추천 기록 목록">
        <div className="planning-history-tools">
          <label>
            기록 상태
            <select
              aria-label="기록 상태"
              value={state}
              onChange={(e) => {
                setState(e.target.value);
                setCursors([]);
              }}
            >
              <option value="all">전체</option>
              <option value="pending">검토 가능</option>
              <option value="approved">저장 완료</option>
              <option value="expired">유효 시간 지남</option>
            </select>
          </label>
          <button className="secondary" onClick={result.reload}>
            새로고침
          </button>
        </div>
        <p className="small muted">
          처음 저장한 시간과 현재 캘린더의 시간을 비교할 수 있습니다. 저장하지
          않은 추천은 만료된 기록을 포함해 최근 30개까지 보관합니다.
        </p>
        {result.loading ? (
          <Loading />
        ) : result.error ? (
          <ErrorNotice message={result.error} retry={result.reload} />
        ) : result.data?.entries.length ? (
          <>
            <ul className="planning-history-list">
              {result.data.entries.map((entry) => (
                <li key={entry.id}>
                  <span className={`tag planning-state-${entry.state}`}>
                    {stateLabels[entry.state]}
                  </span>
                  <h2>
                    {entry.task_titles.slice(0, 3).join(" · ") ||
                      "시간 추천 기록"}
                    {entry.task_count > 3
                      ? ` 외 ${entry.task_count - 3}개`
                      : ""}
                  </h2>
                  <p className="small muted">
                    생성 {formatSeoul(entry.created_at)} ·{" "}
                    {entry.approved_at
                      ? `저장 ${formatSeoul(entry.approved_at)}`
                      : `유효 시간 ${formatSeoul(entry.expires_at)}`}
                  </p>
                  <p>
                    {formatSeoul(entry.start_at)} ~ {formatSeoul(entry.end_at)}
                  </p>
                  <p className="small">
                    할 일 {entry.task_count}개 ·{" "}
                    {entry.state === "approved" ? "저장한 시간" : "추천 시간"}{" "}
                    {entry.block_count}개 · 시간을 찾지 못한 할 일{" "}
                    {entry.unplaced_count}개
                  </p>
                  {entry.blocked && entry.state !== "approved" && (
                    <p className="notice">
                      기존 일정을 모두 확인하지 못한 기록입니다. 새 미리보기를
                      만들어 주세요.
                    </p>
                  )}
                  {entry.saved_state && (
                    <SavedStateNotice state={entry.saved_state} />
                  )}
                  <Link
                    className="button secondary"
                    href={`/planning?${new URLSearchParams({ plan: entry.id })}`}
                  >
                    {entry.state === "approved"
                      ? "기록 보기 · 시간 관리"
                      : entry.state === "expired"
                        ? "만료된 기록 보기"
                        : "미리보기 열기"}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="notice">해당 상태의 시간 추천 기록이 없습니다.</p>
        )}
        <div className="planning-history-pagination">
          <button
            className="secondary"
            disabled={result.loading || !cursors.length}
            onClick={() => setCursors((current) => current.slice(0, -1))}
          >
            이전 기록
          </button>
          <span>{cursors.length + 1}페이지</span>
          <button
            className="secondary"
            disabled={result.loading || !result.data?.next_cursor}
            onClick={() => {
              const next = result.data?.next_cursor;
              if (next) setCursors((current) => [...current, next]);
            }}
          >
            다음 기록
          </button>
        </div>
      </section>
    </div>
  );
}
