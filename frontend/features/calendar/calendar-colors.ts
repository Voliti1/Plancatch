import { useState } from "react";

export const calendarColors = [
  { id: "blue", label: "파랑", value: "#3158b7" },
  { id: "teal", label: "청록", value: "#176f6b" },
  { id: "green", label: "초록", value: "#387036" },
  { id: "amber", label: "황토", value: "#885516" },
  { id: "red", label: "빨강", value: "#af3f4f" },
  { id: "purple", label: "보라", value: "#7045a5" },
] as const;

export type CalendarColor = (typeof calendarColors)[number]["id"];
type CalendarKind = "task" | "deadline";
const themeDefaults = {
  task: { label: "파랑", value: "var(--schedule-task)" },
  deadline: { label: "진분홍", value: "var(--schedule-deadline)" },
};
const palette = new Map<string, string>(
  calendarColors.map(({ id, value }) => [id, value]),
);

function readColors(key: string | null): Record<string, CalendarColor> {
  try {
    const data = key
      ? JSON.parse(window.localStorage.getItem(key) ?? "{}")
      : {};
    return Object.fromEntries(
      Object.entries(data ?? {}).filter(
        (entry): entry is [string, CalendarColor] =>
          typeof entry[1] === "string" && palette.has(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

function storeColors(
  key: string | null,
  colors: Record<string, CalendarColor>,
) {
  try {
    if (key) window.localStorage.setItem(key, JSON.stringify(colors));
  } catch {
    // Keep this session's choices if browser storage is unavailable.
  }
}

export function useCalendarColors(userId: string | undefined) {
  const key = userId ? `plancatch:calendar-colors:${userId}` : null;
  const defaultsKey = key ? `${key}:defaults` : null;
  const [colors, setColors] = useState(() => readColors(key));
  const [defaults, setDefaults] = useState(() => readColors(defaultsKey));

  function changeColor(eventKey: string, color: CalendarColor | null) {
    const next = { ...colors };
    if (color) next[eventKey] = color;
    else delete next[eventKey];
    setColors(next);
    storeColors(key, next);
  }

  function changeDefaultColor(kind: CalendarKind, color: CalendarColor | null) {
    const next = { ...defaults };
    if (color) next[kind] = color;
    else delete next[kind];
    setDefaults(next);
    storeColors(defaultsKey, next);
  }

  return {
    colors,
    changeColor,
    changeDefaultColor,
    defaultColor: (kind: CalendarKind) => ({
      ...themeDefaults[kind],
      ...calendarColors.find(({ id }) => id === defaults[kind]),
    }),
    swatch: (eventKey: string, kind: CalendarKind) =>
      palette.get(colors[eventKey]) ?? palette.get(defaults[kind]),
  };
}
