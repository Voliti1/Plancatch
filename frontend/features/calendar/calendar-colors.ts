import { useState } from "react";

export const calendarColors = [
  { id: "blue", label: "파랑", value: "#3158b7" },
  { id: "teal", label: "청록", value: "#176f6b" },
  { id: "green", label: "초록", value: "#387036" },
  { id: "amber", label: "황토", value: "#885516" },
  { id: "red", label: "빨강", value: "#af3f4f" },
  { id: "purple", label: "보라", value: "#7045a5" },
] as const;

type Color = (typeof calendarColors)[number]["id"];
const palette = new Map<string, string>(
  calendarColors.map(({ id, value }) => [id, value]),
);

export function useCalendarColors(userId: string | undefined) {
  const key = userId ? `plancatch:calendar-colors:${userId}` : null;
  const [colors, setColors] = useState<Record<string, Color>>(() => {
    try {
      const data = key
        ? JSON.parse(window.localStorage.getItem(key) ?? "{}")
        : {};
      return Object.fromEntries(
        Object.entries(data ?? {}).filter(
          (entry): entry is [string, Color] =>
            typeof entry[1] === "string" && palette.has(entry[1]),
        ),
      );
    } catch {
      return {};
    }
  });

  function changeColor(eventKey: string, color: Color | null) {
    const next = { ...colors };
    if (color) next[eventKey] = color;
    else delete next[eventKey];
    setColors(next);
    try {
      if (key) window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Keep this session's choices if browser storage is unavailable.
    }
  }

  return {
    colors,
    changeColor,
    swatch: (eventKey: string) => palette.get(colors[eventKey]),
  };
}
