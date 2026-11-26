"use client";
import { useId } from "react";
export const CATEGORIES = [
  { value: "career", label: "취업·공고", color: "#2563eb" },
  { value: "study", label: "학업·과제", color: "#8b5cf6" },
  { value: "work", label: "업무·프로젝트", color: "#16a34a" },
  { value: "personal", label: "개인", color: "#ea580c" },
  { value: "other", label: "기타", color: "#64748b" },
] as const;
export type Category = (typeof CATEGORIES)[number]["value"];
export function CategoryBadge({ value, compact = false }: { value?: Category | null; compact?: boolean }) {
  const item = CATEGORIES.find((item) => item.value === value);
  if (item && compact) return <span className="category-dot" style={{background:item.color}} title={item.label} aria-label={item.label} />;
  return item ? (
    <span className="category-badge">
      <span style={{ background: item.color }} aria-hidden="true" />
      {item.label}
    </span>
  ) : null;
}
export function CategorySelect({
  value,
  onChange,
  disabled = false,
}: {
  value: Category | null;
  onChange: (value: Category | null) => void;
  disabled?: boolean;
}) {
  const labelId = useId();
  return (
    <label>
      <span id={labelId}>카테고리</span>
      <select aria-labelledby={labelId}
        disabled={disabled}
        value={value ?? ""}
        onChange={(event) =>
          onChange((event.target.value || null) as Category | null)
        }
      >
        <option value="">미지정</option>
        {CATEGORIES.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
    </label>
  );
}
export function CategoryFilter({
  value,
  onChange,
}: {
  value: Category | null;
  onChange: (value: Category | null) => void;
}) {
  return (
    <div className="category-filters" role="group" aria-label="카테고리 필터">
      {[{ value: null, label: "전체" }, ...CATEGORIES].map((item) => (
        <button
          key={item.value ?? "all"}
          type="button"
          className="secondary"
          aria-pressed={value === item.value}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
