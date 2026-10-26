"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./title-search.module.css";

// Keep the search value and pagination together so a new query starts on page one.
export function useTitleSearch() {
  const [filter, setFilter] = useState({ query: "", page: 0 });
  return {
    ...filter,
    apply: (query: string) => setFilter({ query, page: 0 }),
    setPage: (page: number) => setFilter((value) => ({ ...value, page })),
  };
}

export function TitleSearch({
  label,
  query,
  disabled,
  onApply,
  onEdit,
}: {
  label: string;
  query: string;
  disabled: boolean;
  onApply: (query: string) => void;
  onEdit: () => void;
}) {
  const [draft, setDraft] = useState(query);
  const [composing, setComposing] = useState(false);
  const apply = useRef(onApply);
  useEffect(() => {
    apply.current = onApply;
  });
  useEffect(() => {
    const next = draft.trim();
    if (disabled || composing || next === query) return;
    const timer = setTimeout(() => apply.current(next), 300);
    return () => clearTimeout(timer);
  }, [draft, composing, query, disabled]);
  return (
    <form
      className={styles.form}
      role="search"
      aria-label={label}
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && !composing) onApply(draft.trim());
      }}
    >
      <div className={styles.field}>
        <label htmlFor="title-search">{label}</label>
        <input
          id="title-search"
          type="search"
          value={draft}
          maxLength={255}
          placeholder="제목을 입력하세요"
          disabled={disabled}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={(event) => {
            setComposing(false);
            setDraft(event.currentTarget.value);
          }}
          onChange={(event) => {
            onEdit();
            setDraft(event.target.value);
          }}
        />
      </div>
      <button type="submit" disabled={disabled || composing}>
        검색
      </button>
    </form>
  );
}

export function HighlightTitle({
  title,
  query,
}: {
  title: string;
  query: string;
}) {
  if (!query) return <>{title}</>;
  // Escape literal input before matching; render only React text, never HTML.
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(escaped, "gi");
  const parts: ReactNode[] = [];
  let from = 0;
  for (const match of title.matchAll(matcher)) {
    const index = match.index!;
    parts.push(title.slice(from, index));
    parts.push(
      <mark className={styles.match} key={index}>
        {match[0]}
      </mark>,
    );
    from = index + match[0].length;
  }
  parts.push(title.slice(from));
  return <>{parts}</>;
}
