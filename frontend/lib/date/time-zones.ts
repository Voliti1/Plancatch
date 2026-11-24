export const SEOUL = "Asia/Seoul";

export const timeZones = [
  ["Pacific/Honolulu", "미국 · 호놀룰루"],
  ["America/Anchorage", "미국 · 앵커리지"],
  ["America/Los_Angeles", "미국 · 로스앤젤레스"],
  ["America/Denver", "미국 · 덴버"],
  ["America/Phoenix", "미국 · 피닉스"],
  ["America/Chicago", "미국 · 시카고"],
  ["America/Mexico_City", "멕시코 · 멕시코시티"],
  ["America/New_York", "미국 · 뉴욕"],
  ["America/Toronto", "캐나다 · 토론토"],
  ["America/Sao_Paulo", "브라질 · 상파울루"],
  ["UTC", "협정 세계시"],
  ["Europe/London", "영국 · 런던"],
  ["Europe/Paris", "프랑스 · 파리"],
  ["Europe/Berlin", "독일 · 베를린"],
  ["Europe/Athens", "그리스 · 아테네"],
  ["Africa/Johannesburg", "남아공 · 요하네스버그"],
  ["Europe/Istanbul", "튀르키예 · 이스탄불"],
  ["Asia/Dubai", "아랍에미리트 · 두바이"],
  ["Asia/Karachi", "파키스탄 · 카라치"],
  ["Asia/Kolkata", "인도 · 콜카타"],
  ["Asia/Kathmandu", "네팔 · 카트만두"],
  ["Asia/Dhaka", "방글라데시 · 다카"],
  ["Asia/Bangkok", "태국 · 방콕"],
  ["Asia/Ho_Chi_Minh", "베트남 · 호찌민"],
  ["Asia/Jakarta", "인도네시아 · 자카르타"],
  ["Asia/Shanghai", "중국 · 상하이"],
  ["Asia/Taipei", "대만 · 타이베이"],
  ["Asia/Singapore", "싱가포르"],
  ["Australia/Perth", "호주 · 퍼스"],
  [SEOUL, "한국 시간"],
  ["Asia/Tokyo", "일본 · 도쿄"],
  ["Australia/Adelaide", "호주 · 애들레이드"],
  ["Australia/Brisbane", "호주 · 브리즈번"],
  ["Australia/Sydney", "호주 · 시드니"],
  ["Pacific/Auckland", "뉴질랜드 · 오클랜드"],
] as const;

export const zoneName = (zone: string) =>
  timeZones.find(([id]) => id === zone)?.[1] ?? zone;

export const preferredZone = (zone?: string | null) =>
  timeZones.some(([id]) => id === zone) && zone ? zone : SEOUL;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(
  zone: string,
  kind: "display" | "input" | "clock" | "offset",
) {
  const key = zone + ":" + kind;
  const existing = formatters.get(key);
  if (existing) return existing;
  const options: Intl.DateTimeFormatOptions = { timeZone: zone };
  if (kind === "display")
    Object.assign(options, { dateStyle: "medium", timeStyle: "short" });
  if (kind === "input")
    Object.assign(options, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  if (kind === "clock")
    Object.assign(options, {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  if (kind === "offset") options.timeZoneName = "longOffset";
  const result = new Intl.DateTimeFormat(
    kind === "input" ? "sv-SE" : kind === "offset" ? "en-US" : "ko-KR",
    options,
  );
  formatters.set(key, result);
  return result;
}

export function formatDateTime(value: string, zone = SEOUL) {
  return formatter(zone, "display").format(new Date(value));
}

export function localInput(value: string | number, zone = SEOUL) {
  return formatter(zone, "input")
    .format(new Date(value))
    .replace(" ", "T")
    .slice(0, -3);
}

export function clockTime(now: Date, zone: string) {
  return formatter(zone, "clock").format(now);
}

export function gmtOffset(now: Date, zone: string) {
  return (
    formatter(zone, "offset")
      .formatToParts(now)
      .find((part) => part.type === "timeZoneName")?.value ?? "GMT"
  );
}

function offsetMinutes(timestamp: number, zone: string) {
  const offset = gmtOffset(new Date(timestamp), zone);
  const parts = /GMT([+-])(\d{2}):(\d{2})/.exec(offset);
  if (!parts) return 0;
  return (
    (parts[1] === "-" ? -1 : 1) * (Number(parts[2]) * 60 + Number(parts[3]))
  );
}

export function zonedInputToUtc(
  value: string,
  zone = SEOUL,
  onGap: "reject" | "next" = "reject",
) {
  const wallTime = Date.parse(value + ":00Z");
  if (!Number.isFinite(wallTime))
    throw new Error("날짜와 시간을 확인해 주세요.");
  if (zone === SEOUL) return new Date(value + ":00+09:00").toISOString();
  // Check both sides of the day for clock changes. Keep the earlier instant when
  // a local time occurs twice. Existing unchanged timestamps are kept by callers.
  const day = 86400000;
  const candidates = [
    ...new Set(
      [-day, 0, day].map(
        (delta) => wallTime - offsetMinutes(wallTime + delta, zone) * 60000,
      ),
    ),
  ].sort((a, b) => a - b);
  const match = candidates.find((time) => localInput(time, zone) === value);
  if (match !== undefined) return new Date(match).toISOString();
  if (onGap === "next") {
    const next = candidates.find((time) => localInput(time, zone) > value);
    if (next !== undefined) return new Date(next).toISOString();
  }
  throw new Error(
    "이 지역의 시계 변경으로 존재하지 않는 시각입니다. 다른 시간을 선택해 주세요.",
  );
}
