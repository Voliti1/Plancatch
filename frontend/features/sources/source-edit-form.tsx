"use client";
import { useId, useRef, useState } from "react";
import { ErrorNotice } from "@/components/feedback";
import { errorMessage } from "@/lib/api/client";
import { useHydrated } from "@/lib/use-hydrated";
import type { Source, SourceUpdateInput } from "@/types/api";

export function SourceEditForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: Source;
  onSave: (payload: SourceUpdateInput) => Promise<void>;
  onCancel: () => void;
}) {
  const hydrated = useHydrated();
  const contentLabelId = useId();
  const [title, setTitle] = useState(initial.title ?? "");
  const [content, setContent] = useState(
    initial.source_type === "url"
      ? (initial.original_url ?? "")
      : (initial.original_text ?? ""),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const isUrl = initial.source_type === "url";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      if (!content.trim()) throw new Error("원본 내용을 입력해 주세요.");
      const updatedTitle = title.trim() || null;
      if (isUrl) {
        let url: URL;
        try {
          url = new URL(content.trim());
        } catch {
          throw new Error("올바른 URL을 입력해 주세요.");
        }
        if (url.protocol !== "http:" && url.protocol !== "https:")
          throw new Error("http 또는 https로 시작하는 URL을 입력해 주세요.");
        await onSave({ title: updatedTitle, original_url: content.trim() });
      } else {
        await onSave({ title: updatedTitle, original_text: content });
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <fieldset disabled={busy || !hydrated}>
        <label>
          자료 제목 (선택)
          <input
            name="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={255}
            autoFocus
          />
        </label>
        <label>
          <span id={contentLabelId}>{isUrl ? "원본 URL" : "원본 텍스트"}</span>
          {isUrl ? (
            <input
              name="content"
              aria-labelledby={contentLabelId}
              type="url"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              required
            />
          ) : (
            <textarea
              name="content"
              aria-labelledby={contentLabelId}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              rows={9}
              required
            />
          )}
        </label>
        {error && <ErrorNotice message={error} />}
        <div className="form-actions">
          <button className="secondary" type="button" onClick={onCancel}>
            취소
          </button>
          <button type="submit">{busy ? "저장 중…" : "변경 사항 저장"}</button>
        </div>
      </fieldset>
    </form>
  );
}
