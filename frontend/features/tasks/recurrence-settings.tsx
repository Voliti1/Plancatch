"use client";
import { useId } from "react";
import { toSeoulInput } from "@/lib/date/seoul";
export type Recurrence = {
  frequency: "daily" | "weekly" | "monthly";
  interval: number;
  count?: number | null;
  until?: string | null;
};
const names = { daily: "일", weekly: "주", monthly: "개월" };
export function recurrenceSummary(value?: Recurrence | null) {
  if (!value) return "반복 안 함";
  return `${value.interval}${names[value.frequency]}마다 반복${value.count ? ` · ${value.count}회` : value.until ? ` · ${value.until}까지` : " · 종료일 없음"}`;
}
export function validateRecurrence(
  value: Recurrence | null,
  start: string,
  end: string,
) {
  if (!value) return;
  if (!start || !end)
    throw new Error("반복할 일정의 시작·종료 일시를 입력해 주세요.");
  if (
    !Number.isInteger(value.interval) ||
    value.interval < 1 ||
    value.interval > 99
  )
    throw new Error("반복 간격은 1부터 99 사이로 입력해 주세요.");
  if (
    value.count != null &&
    (!Number.isInteger(value.count) || value.count < 1 || value.count > 1000)
  )
    throw new Error("반복 횟수는 1부터 1000 사이로 입력해 주세요.");
  if (value.until && value.until < start.slice(0, 10))
    throw new Error("반복 종료일은 첫 일정 날짜 이후로 설정해 주세요.");
}
export function RecurrenceSettings({
  value,
  onChange,
}: {
  value: Recurrence | null;
  onChange: (value: Recurrence | null) => void;
}) {
  const id = useId();
  const today = toSeoulInput(new Date().toISOString()).slice(0, 10);
  const [year, month] = today.split("-").map(Number);
  const monthEnd = `${year}-${String(month).padStart(2, "0")}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}`;
  return (
    <section className="recurrence-settings" aria-label="반복 일정 설정">
      <label>
        <span id={`${id}-frequency`}>반복 주기</span>
        <select
          aria-labelledby={`${id}-frequency`}
          value={value?.frequency ?? "none"}
          onChange={(event) => {
            const frequency = event.target.value as
              Recurrence["frequency"] | "none";
            onChange(
              frequency === "none"
                ? null
                : { ...value, frequency, interval: value?.interval ?? 1 },
            );
          }}
        >
          <option value="none">반복 안 함</option>
          <option value="daily">매일</option>
          <option value="weekly">매주</option>
          <option value="monthly">매월</option>
        </select>
      </label>
      {value && (
        <>
          <div className="form-grid">
            <label>
              반복 간격 ({names[value.frequency]})
              <input
                type="number"
                min={1}
                max={99}
                step={1}
                value={value.interval}
                onChange={(e) =>
                  onChange({ ...value, interval: Number(e.target.value) })
                }
              />
            </label>
            <label>
              <span id={`${id}-end`}>반복 종료</span>
              <select
                aria-labelledby={`${id}-end`}
                value={
                  value.count != null
                    ? "count"
                    : value.until != null
                      ? value.until === monthEnd
                        ? "month"
                        : "until"
                      : "never"
                }
                onChange={(e) =>
                  onChange({
                    ...value,
                    count: e.target.value === "count" ? 10 : null,
                    until:
                      e.target.value === "month"
                        ? monthEnd
                        : e.target.value === "until"
                          ? ""
                          : null,
                  })
                }
              >
                <option value="never">종료일 없음</option>
                <option value="until">날짜 지정</option>
                <option value="month">이번 달까지만</option>
                <option value="count">횟수 지정</option>
              </select>
            </label>
          </div>
          {value.count != null && (
            <label>
              반복 횟수 (첫 일정 포함)
              <input
                type="number"
                min={1}
                max={1000}
                step={1}
                value={value.count}
                onChange={(e) =>
                  onChange({ ...value, count: Number(e.target.value) })
                }
              />
            </label>
          )}
          {value.until != null && (
            <label>
              반복 종료일
              <input
                type="date"
                required
                value={value.until}
                onChange={(e) => onChange({ ...value, until: e.target.value })}
              />
            </label>
          )}
          <p className="small muted">
            한국 시간 기준으로 첫 일정과 같은 시각에 반복됩니다. 매주는 같은
            요일, 매월은 같은 날짜를 사용하며 해당 날짜가 없는 달은 건너뜁니다.
            종료일 당일에 시작하는 일정까지 포함됩니다. 캘린더에서 날짜별 일정을
            열면 이번 일정만 수정·삭제할 수 있습니다.
          </p>
        </>
      )}
    </section>
  );
}
