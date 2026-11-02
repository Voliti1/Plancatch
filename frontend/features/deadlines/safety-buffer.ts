export const MAX_SAFETY_BUFFER_MINUTES = 2147483647;

export interface SafetyBufferParts {
  days: string;
  hours: string;
  minutes: string;
}

export function splitSafetyBuffer(value: number | null): SafetyBufferParts {
  if (value == null) return { days: "", hours: "", minutes: "" };
  return {
    days: String(Math.floor(value / 1440)),
    hours: String(Math.floor((value % 1440) / 60)),
    minutes: String(value % 60),
  };
}

export function parseSafetyBuffer(parts: SafetyBufferParts): number {
  const values = [parts.days, parts.hours, parts.minutes].map((value) => {
    const text = value.trim();
    if (!text) return 0;
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)))
      throw new Error("여유시간은 음수나 소수 없이 정수로 입력해 주세요.");
    return Number(text);
  });
  const total = values[0] * 1440 + values[1] * 60 + values[2];
  if (
    !Number.isSafeInteger(total) ||
    total < 1 ||
    total > MAX_SAFETY_BUFFER_MINUTES
  )
    throw new Error("여유시간의 합계를 1~2,147,483,647분으로 입력해 주세요.");
  return total;
}

export function formatSafetyBuffer(value: number): string {
  const days = Math.floor(value / 1440);
  const hours = Math.floor((value % 1440) / 60);
  const minutes = value % 60;
  return [
    days && `${days}일`,
    hours && `${hours}시간`,
    minutes && `${minutes}분`,
  ]
    .filter(Boolean)
    .join(" ");
}
