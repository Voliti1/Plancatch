"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { sourcesApi } from "./api";
import { errorMessage } from "@/lib/api/client";
import { ErrorNotice } from "@/components/feedback";
import { PageHeading } from "@/components/page-heading";
import { useHydrated } from "@/lib/use-hydrated";
export function SourceForm() {
  const hydrated = useHydrated();
  const [type, setType] = useState<"url" | "text">("url");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const title = String(form.get("title")).trim() || undefined;
      const content = String(form.get("content")).trim();
      if (!content) throw new Error("내용을 입력해 주세요.");
      if (type === "url" && !/^https?:\/\//i.test(content))
        throw new Error("http 또는 https로 시작하는 URL을 입력해 주세요.");
      await sourcesApi.create(
        type === "url"
          ? { source_type: type, title, original_url: content }
          : { source_type: type, title, original_text: content },
      );
      router.push("/sources");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="NEW SOURCE"
        title="자료 등록"
        description="마감일을 정리할 때 필요한 원본 자료를 저장하세요."
      />
      <form className="card form-card" onSubmit={submit}>
        <fieldset disabled={busy || !hydrated}>
          <div className="segmented" aria-label="자료 유형">
            <button
              type="button"
              className={type === "url" ? "selected" : "secondary"}
              aria-pressed={type === "url"}
              onClick={() => setType("url")}
            >
              URL 링크
            </button>
            <button
              type="button"
              className={type === "text" ? "selected" : "secondary"}
              aria-pressed={type === "text"}
              onClick={() => setType("text")}
            >
              텍스트
            </button>
          </div>
          <label>
            자료 제목 (선택)
            <input
              name="title"
              maxLength={255}
              placeholder="예: 프로젝트 최종 발표 안내"
            />
          </label>
          <label>
            {type === "url" ? "원본 URL" : "원본 텍스트"}
            {type === "url" ? (
              <input
                key="url"
                name="content"
                type="url"
                required
                placeholder="https://…"
              />
            ) : (
              <textarea
                key="text"
                name="content"
                rows={9}
                required
                placeholder="공지, 과제 안내, 메모 등을 붙여 넣어 주세요."
              />
            )}
          </label>
          <p className="muted small">
            자료 저장 후 AI 분석은 아직 실행되지 않습니다.
          </p>
          {error && <ErrorNotice message={error} />}
          <div className="form-actions">
            <Link className="button secondary" href="/sources">
              취소
            </Link>
            <button type="submit">{busy ? "저장 중…" : "자료 저장"}</button>
          </div>
        </fieldset>
      </form>
    </>
  );
}
