"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { sourcesApi } from "./api";
import { SourceFileInput } from "./source-file-input";
import { errorMessage } from "@/lib/api/client";
import { ErrorNotice } from "@/components/feedback";
import { PageHeading } from "@/components/page-heading";
import { useHydrated } from "@/lib/use-hydrated";
import "./source-registration.css";
export function SourceForm() {
  const hydrated = useHydrated();
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const router = useRouter();
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || !hydrated) return;
    setError("");
    const originalUrl = url.trim();
    const hasText = Boolean(text.trim());
    if (files.length) {
      setError(
        "파일 업로드는 준비 중입니다. URL 또는 텍스트를 저장하려면 선택한 파일을 먼저 제거해 주세요.",
      );
      return;
    }
    if (!originalUrl && !hasText) {
      setError("URL 또는 텍스트를 입력해 주세요.");
      return;
    }
    if (originalUrl && hasText) {
      setError(
        "한 번에 하나의 자료를 저장할 수 있어요. URL 또는 텍스트 중 하나만 입력해 주세요.",
      );
      return;
    }
    if (originalUrl) {
      try {
        const parsed = new URL(originalUrl);
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
      } catch {
        setError(
          "http:// 또는 https://로 시작하는 올바른 URL을 입력해 주세요.",
        );
        return;
      }
    }
    pending.current = true;
    setBusy(true);
    try {
      const sourceTitle = title.trim() || undefined;
      await sourcesApi.create(
        originalUrl
          ? {
              source_type: "url",
              title: sourceTitle,
              original_url: originalUrl,
            }
          : { source_type: "text", title: sourceTitle, original_text: text },
      );
      router.push("/sources");
    } catch (err) {
      setError(errorMessage(err));
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <Link className="back-link" href="/dashboard">
        ← 대시보드
      </Link>
      <PageHeading
        eyebrow="NEW SCHEDULE"
        title="새 일정 등록"
        description="일정이 담긴 자료를 등록하고, 상세 화면에서 원문 추출과 AI 검토를 이어가세요."
      />
      <form className="card source-registration" onSubmit={submit} noValidate>
        <div className="source-registration-heading">
          <h2>자료 입력</h2>
          <ol className="source-registration-steps" aria-label="일정 등록 단계">
            <li aria-current="step">
              <span>1</span>자료 입력
            </li>
            <li>
              <span>2</span>AI 검토
            </li>
            <li>
              <span>3</span>마감일 승인
            </li>
          </ol>
        </div>
        <fieldset disabled={busy || !hydrated}>
          <label>
            자료 제목 (선택)
            <input
              name="title"
              maxLength={255}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="예: 프로젝트 최종 발표 안내"
            />
          </label>
          <div className="source-registration-grid">
            <SourceFileInput
              files={files}
              onChange={setFiles}
              disabled={busy || !hydrated}
            />
            <div className="source-registration-fields">
              <section aria-labelledby="source-url-heading">
                <h3 id="source-url-heading">URL로 추가</h3>
                <label htmlFor="source-new-url">원본 URL</label>
                <input
                  id="source-new-url"
                  name="url"
                  type="url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://example.com/notice"
                  aria-describedby="source-url-help"
                />
                <p id="source-url-help" className="small muted">
                  일정이 안내된 공지나 게시글 주소를 붙여 넣으세요.
                </p>
              </section>
              <section aria-labelledby="source-text-heading">
                <h3 id="source-text-heading">텍스트로 추가</h3>
                <label htmlFor="source-new-text">원본 텍스트</label>
                <textarea
                  id="source-new-text"
                  name="text"
                  rows={6}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  placeholder="공지, 과제 안내, 메모 등을 붙여 넣어 주세요."
                  aria-describedby="source-text-count"
                />
                <p
                  id="source-text-count"
                  className="small muted source-text-count"
                >
                  {text.length.toLocaleString("ko-KR")}자 입력
                </p>
              </section>
            </div>
          </div>
          <p className="small muted source-registration-help">
            URL 또는 텍스트 중 하나를 저장할 수 있어요. 자료 저장만으로 마감일이
            생성되지는 않으며, 상세 화면에서 AI 검토 후 승인해야 합니다.
          </p>
          {error && <ErrorNotice message={error} />}
          <div className="form-actions source-registration-actions">
            <Link
              className="button secondary"
              href="/sources"
              aria-disabled={busy || undefined}
              onClick={(event) => {
                if (busy) event.preventDefault();
              }}
            >
              취소
            </Link>
            <button
              type="submit"
              disabled={busy || !hydrated || files.length > 0}
            >
              {busy ? "저장 중…" : "자료 저장"}
            </button>
          </div>
        </fieldset>
      </form>
    </>
  );
}
