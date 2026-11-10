"use client";
import { useId } from "react";
import type { ReactNode } from "react";
import type { GoogleReminderSettings } from "@/types/google-reminders";
import "./reminder-settings.css";

export function reminderSummary(value?: GoogleReminderSettings | null) {
  if (!value) return "Google에서 설정한 알림 유지";
  if (value.mode === "none") return "알림 없음";
  if (value.mode === "default") return "구글 캘린더 기본 알림";
  return value.overrides
    .map(
      (item) =>
        `${item.minutes === 0 ? "시작 시각" : item.minutes % 1440 === 0 ? `${item.minutes / 1440}일 전` : item.minutes % 60 === 0 ? `${item.minutes / 60}시간 전` : `${item.minutes}분 전`} ${item.method === "email" ? "이메일" : "브라우저 알림"}`,
    )
    .join(" · ");
}

export function ReminderSettings({
  value,
  onChange,
  allowPreserve = false,
  registrationKind,
  connectionNotice,
}: {
  value: GoogleReminderSettings | null;
  onChange: (value: GoogleReminderSettings | null) => void;
  allowPreserve?: boolean;
  registrationKind?: "task" | "deadline";
  connectionNotice?: ReactNode;
}) {
  const id = useId();
  function update(
    index: number,
    patch: Partial<GoogleReminderSettings["overrides"][number]>,
  ) {
    onChange({
      mode: "custom",
      overrides: value!.overrides.map((item, i) =>
        i === index ? { ...item, ...patch } : item,
      ),
    });
  }
  return (
    <div className="google-reminder-settings">
      <label>
        구글 캘린더 알림
        <select
          aria-label="구글 캘린더 알림"
          aria-describedby={id}
          value={value?.mode ?? "preserve"}
          onChange={(event) => {
            if (event.target.value === "preserve") {
              onChange(null);
              return;
            }
            const mode = event.target.value as GoogleReminderSettings["mode"];
            onChange({
              mode,
              overrides:
                mode === "custom" ? [{ method: "popup", minutes: 30 }] : [],
            });
          }}
        >
          {allowPreserve && (
            <option value="preserve">Google에서 설정한 알림 유지</option>
          )}
          <option value="none">알림 없음</option>
          <option value="default">구글 캘린더 기본 알림 사용</option>
          <option value="custom">직접 설정</option>
        </select>
      </label>
      {value?.mode === "custom" && (
        <div role="group" aria-label="알림 시간 설정">
          {value.overrides.map((item, index) => (
            <div className="google-reminder-row" key={index}>
              <label>
                알림 {index + 1} 방식
                <select
                  aria-label={`알림 ${index + 1} 방식`}
                  value={item.method}
                  onChange={(event) =>
                    update(index, {
                      method: event.target.value as "email" | "popup",
                    })
                  }
                >
                  <option value="popup">브라우저 알림</option>
                  <option value="email">이메일</option>
                </select>
              </label>
              <label>
                알림 {index + 1} 시간 (분 전)
                <input
                  type="number"
                  min={0}
                  max={40320}
                  step={1}
                  required
                  value={Number.isNaN(item.minutes) ? "" : item.minutes}
                  onChange={(event) =>
                    update(index, {
                      minutes:
                        event.target.value === ""
                          ? NaN
                          : Number(event.target.value),
                    })
                  }
                />
              </label>
              <button
                type="button"
                className="secondary"
                aria-label={`알림 ${index + 1} 삭제`}
                disabled={value.overrides.length === 1}
                onClick={() =>
                  onChange({
                    mode: "custom",
                    overrides: value.overrides.filter((_, i) => i !== index),
                  })
                }
              >
                삭제
              </button>
            </div>
          ))}
          <div className="google-reminder-actions">
            <button
              type="button"
              className="secondary"
              disabled={value.overrides.length >= 5}
              onClick={() =>
                onChange({
                  mode: "custom",
                  overrides: [
                    ...value.overrides,
                    { method: "popup", minutes: 60 },
                  ],
                })
              }
            >
              알림 추가
            </button>
            <span className="small muted">
              30분 전: 30 · 1시간 전: 60 · 하루 전: 1440
            </span>
          </div>
        </div>
      )}
      <p id={id} className="small muted">
        {registrationKind
          ? `${registrationKind === "task" ? "시작" : "마감"} 시각을 기준으로 알림을 받아요. 브라우저 알림을 받으려면 Google Calendar에서 알림을 허용해 주세요.`
          : "Google 계정 연결 후 반영됩니다. 할 일은 시작 시각, 마감일은 마감 시각을 기준으로 알려줍니다. 브라우저 알림은 Google Calendar의 알림 허용이 필요합니다."}
      </p>
      {connectionNotice}
    </div>
  );
}

export function validateReminders(value: GoogleReminderSettings | null) {
  if (!value || value.mode !== "custom") return;
  if (
    value.overrides.length < 1 ||
    value.overrides.length > 5 ||
    value.overrides.some(
      (item) =>
        !Number.isInteger(item.minutes) ||
        item.minutes < 0 ||
        item.minutes > 40320,
    )
  )
    throw new Error(
      "알림 시간은 분 단위로 소수점 없이 입력해 주세요. 최대 4주 전까지, 알림은 5개까지 설정할 수 있습니다.",
    );
  if (
    new Set(value.overrides.map((item) => `${item.method}:${item.minutes}`))
      .size !== value.overrides.length
  )
    throw new Error("같은 방식과 시간의 알림이 중복되어 있습니다.");
}
