"use client";
import { useSyncExternalStore } from "react";
import type { SourcePeriod } from "@/types/analysis";
import { formatSeoul } from "@/lib/date/seoul";

let current: number | null = null;
let interval: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();
function tick() {
  current = Date.now();
  listeners.forEach((listener) => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    current = Date.now();
    interval = setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
      current = null;
    }
  };
}
const snapshot = () => current;
const serverSnapshot = () => null;
export function usePeriodClock() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

export function remainingPeriod(
  dueAt: string | null,
  now: number | null,
): string {
  if (!dueAt || !Number.isFinite(Date.parse(dueAt))) return "마감일 미확정";
  if (now === null) return "계산 중…";
  const seconds = Math.ceil((Date.parse(dueAt) - now) / 1000);
  if (seconds <= 0) return "마감됨";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${days}일 ${hours}시간 ${minutes}분 ${seconds % 60}초`;
}

export function RemainingPeriod({
  dueAt,
  now,
  editing = false,
}: {
  dueAt: string | null;
  now: number | null;
  editing?: boolean;
}) {
  return (
    <p className="remaining-period">
      {editing ? "수정 중인 마감일까지 남은 기간" : "마감일까지 남은 기간"}
      <strong>{remainingPeriod(dueAt, now)}</strong>
      {editing && <span className="small muted">저장 전 입력 기준입니다.</span>}
    </p>
  );
}

export function SourcePeriodSummary({
  period,
  now,
}: {
  period: SourcePeriod;
  now: number | null;
}) {
  const siteNames: Record<NonNullable<SourcePeriod["site"]>, string> = {
    saramin: "사람인",
    jobkorea: "잡코리아",
    catch: "캐치",
    jobplanet: "잡플래닛",
    jasoseol: "자소설닷컴",
    linkareer: "링커리어",
    work24: "고용24",
  };
  const siteName = siteNames[period.site ?? "saramin"];
  const title = `${siteName} 접수기간`;
  return (
    <section className="notice source-period" aria-label={title}>
      <h2>{title}</h2>
      <dl>
        <dt>시작일 (원문)</dt>
        <dd>{period.start_text || "표시 없음"}</dd>
        <dt>마감일 (원문)</dt>
        <dd>{period.end_text || "확인 필요"}</dd>
        {(period.site === "jasoseol" ||
          period.site === "linkareer" ||
          period.site === "work24") &&
          period.deadline_at && (
            <>
              <dt>마감일 (한국 시간)</dt>
              <dd>{formatSeoul(period.deadline_at)}</dd>
            </>
          )}
        <dt>현재 남은 기간</dt>
        <dd>{remainingPeriod(period.deadline_at, now)}</dd>
      </dl>
      {period.site === "work24" &&
        period.deadline_at &&
        /\b24:00\b/.test(period.end_text ?? "") && (
          <p className="small muted">
            원문의 24:00은 다음 날 00:00입니다. 등록 시각은 한국 시간으로
            표시합니다.
          </p>
        )}
      <p className="small muted">
        현재 남은 기간은 원문 마감일과 이 기기의 현재 시각으로 계산합니다. 기업
        사정에 따라 마감일이 변경될 수 있습니다.
      </p>
      {period.has_conflict && (
        <p>접수기간에 충돌이 있습니다. 원문 마감일을 직접 확인해 주세요.</p>
      )}
    </section>
  );
}
