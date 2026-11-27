"use client";
import { useId } from "react";
import type { SafetyBufferParts } from "./safety-buffer";

export function SafetyBufferSettings({
  safetyEnabled,
  safetyParts,
  onEnabledChange,
  onPartsChange,
}: {
  safetyEnabled: boolean;
  safetyParts: SafetyBufferParts;
  onEnabledChange: (enabled: boolean) => void;
  onPartsChange: (parts: SafetyBufferParts) => void;
}) {
  const safetyHelpId = useId();
  return (
    <div className="safety-settings">
      <label className="checkbox safety-toggle">
        <input
          name="safety_enabled"
          type="checkbox"
          checked={safetyEnabled}
          onChange={(event) => onEnabledChange(event.target.checked)}
          aria-describedby={safetyHelpId}
        />
        안전 마감일 사용
      </label>
      <p id={safetyHelpId} className="small muted">
        공식 마감일보다 여유시간만큼 앞선 날짜를 안전 마감으로 저장해요. 1일은
        24시간이며, 연결된 작업이나 일정은 자동으로 변경되지 않아요.
      </p>
      {safetyEnabled && (
        <div className="safety-inputs">
          {(
            [
              ["days", "일"],
              ["hours", "시간"],
              ["minutes", "분"],
            ] as const
          ).map(([key, unit]) => (
            <label key={key}>
              여유시간 ({unit})
              <input
                name={`safety_${key}`}
                type="text"
                inputMode="numeric"
                value={safetyParts[key]}
                placeholder="0"
                onChange={(event) =>
                  onPartsChange({ ...safetyParts, [key]: event.target.value })
                }
                aria-describedby={safetyHelpId}
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
