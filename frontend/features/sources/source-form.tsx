"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { sourcesApi } from "./api";
import { SourceFileInput } from "./source-file-input";
import { errorMessage } from "@/lib/api/client";
import { ErrorNotice } from "@/components/feedback";
import { PageHeading } from "@/components/page-heading";
import { useHydrated } from "@/lib/use-hydrated";
import { NewRegistrationLink } from "@/features/deadlines/new-registration-link";
import { useUnsavedChanges } from "@/lib/unsaved-changes";
import "./source-registration.css";

type SourceInputKind = "file" | "url" | "text";

const INPUT_TABS: readonly {
  value: SourceInputKind;
  label: string;
  hint: string;
}[] = [
  { value: "file", label: "파일 올리기", hint: "PDF · 이미지 캡처" },
  { value: "url", label: "웹페이지 링크", hint: "공고 · 안내 페이지 주소" },
  { value: "text", label: "글 내용 붙여넣기", hint: "공지 · 과제 안내 · 메모" },
];

export function SourceForm({
  embedded = false,
  onBusyChange,
}: {
  embedded?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const hydrated = useHydrated();
  const tabId = useId();
  const [inputKind, setInputKind] = useState<SourceInputKind>("file");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const router = useRouter();
  const { markSaved } = useUnsavedChanges(
    JSON.stringify([
      inputKind,
      title,
      inputKind === "url" ? url : "",
      inputKind === "text" ? text : "",
      inputKind === "file"
        ? files.map((file) => [file.name, file.size, file.lastModified])
        : [],
    ]),
  );

  function selectKind(next: SourceInputKind) {
    if (busy || !hydrated) return;
    setError("");
    setInputKind(next);
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (busy || !hydrated) return;
    const index = INPUT_TABS.findIndex(({ value }) => value === inputKind);
    const target = {
      Home: 0,
      End: INPUT_TABS.length - 1,
      ArrowLeft: (index + INPUT_TABS.length - 1) % INPUT_TABS.length,
      ArrowRight: (index + 1) % INPUT_TABS.length,
    }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    selectKind(INPUT_TABS[target].value);
    event.currentTarget.querySelectorAll("button")[target]?.focus();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || !hydrated) return;
    setError("");
    const originalUrl = url.trim();
    const hasText = Boolean(text.trim());

    if (inputKind === "file") {
      if (!files.length) {
        setError("PDF 또는 이미지 파일을 선택해 주세요.");
        return;
      }
      if (files.length > 1) {
        setError("파일은 한 번에 1개만 올릴 수 있어요.");
        return;
      }
    } else if (inputKind === "url") {
      if (!originalUrl) {
        setError("웹페이지 링크(URL)를 입력해 주세요.");
        return;
      }
      try {
        const parsed = new URL(originalUrl);
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
      } catch {
        setError(
          "http:// 또는 https://로 시작하는 올바른 웹페이지 주소를 입력해 주세요.",
        );
        return;
      }
    } else if (!hasText) {
      setError("공지나 안내문 글 내용을 입력해 주세요.");
      return;
    }

    pending.current = true;
    setBusy(true);
    onBusyChange?.(true);
    try {
      const sourceTitle = title.trim() || undefined;
      const source =
        inputKind === "file"
          ? await sourcesApi.uploadFile(files[0], sourceTitle)
          : await sourcesApi.create(
              inputKind === "url"
                ? {
                    source_type: "url",
                    title: sourceTitle,
                    original_url: originalUrl,
                  }
                : {
                    source_type: "text",
                    title: sourceTitle,
                    original_text: text,
                  },
            );
      // A new keyed registration can replace this form while a save is in flight.
      // Keep the saved source, but never redirect or update its replacement.
      if (active.current) {
        markSaved();
        router.push(`/sources/${encodeURIComponent(source.id)}/review`);
      }
    } catch (err) {
      if (!active.current) return;
      setError(errorMessage(err));
      pending.current = false;
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  return (
    <>
      {!embedded && (
        <>
          <Link className="back-link" href="/dashboard">
            ← 대시보드
          </Link>
          <PageHeading
            eyebrow="새 일정"
            title="새 일정 등록"
            description="자료를 올리면 마감일을 자동으로 찾아 드려요. 확인 후 바로 일정으로 등록할 수 있습니다."
          />
        </>
      )}
      <form className="card source-registration" onSubmit={submit} noValidate>
        <div className="source-registration-heading">
          <h2>자료 올리기</h2>
          <ol className="source-registration-steps" aria-label="일정 등록 단계">
            <li aria-current="step">
              <span>1</span>자료 올리기
            </li>
            <li>
              <span>2</span>마감일 확인
            </li>
            <li>
              <span>3</span>일정 등록
            </li>
          </ol>
        </div>
        <p className="small muted source-registration-guide">
          원하는 방식을 하나 고른 뒤 내용을 입력해 주세요.
        </p>
        <div
          className="source-kind-tabs"
          role="tablist"
          aria-label="자료 입력 방식"
          onKeyDown={handleTabKeyDown}
        >
          {INPUT_TABS.map((tab) => (
            <button
              key={tab.value}
              id={`${tabId}-${tab.value}-tab`}
              type="button"
              role="tab"
              aria-selected={inputKind === tab.value}
              aria-controls={`${tabId}-${tab.value}-panel`}
              tabIndex={inputKind === tab.value ? 0 : -1}
              disabled={busy || !hydrated}
              className="secondary"
              onClick={() => selectKind(tab.value)}
            >
              <span>{tab.label}</span>
              <small>{tab.hint}</small>
            </button>
          ))}
        </div>
        <fieldset disabled={busy || !hydrated}>
          <label>
            일정 제목 (선택)
            <input
              name="title"
              maxLength={255}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="예: 프로젝트 최종 보고서 제출 (비워 두면 자동으로 채워져요)"
            />
          </label>
          <div
            id={`${tabId}-file-panel`}
            role="tabpanel"
            aria-labelledby={`${tabId}-file-tab`}
            hidden={inputKind !== "file"}
            className="source-kind-panel"
          >
            <SourceFileInput
              files={files}
              onChange={setFiles}
              disabled={busy || !hydrated}
            />
          </div>
          <div
            id={`${tabId}-url-panel`}
            role="tabpanel"
            aria-labelledby={`${tabId}-url-tab`}
            hidden={inputKind !== "url"}
            className="source-kind-panel"
          >
            <section
              className="source-registration-fields"
              aria-labelledby="source-url-heading"
            >
              <div>
                <h3 id="source-url-heading">웹페이지 링크로 추가</h3>
                <label htmlFor="source-new-url">웹페이지 주소 (URL)</label>
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
                  로그인 없이 볼 수 있는 공고·안내 페이지 주소를 붙여 넣어
                  주세요. 로그인이 필요하면 내용을 복사해 ‘글 내용 붙여넣기’를
                  이용해 주세요.
                </p>
                <NewRegistrationLink
                  className="text-button"
                  href="/deadlines/auto"
                >
                  링크에서 바로 마감일 찾기 화면 열기 →
                </NewRegistrationLink>
              </div>
            </section>
          </div>
          <div
            id={`${tabId}-text-panel`}
            role="tabpanel"
            aria-labelledby={`${tabId}-text-tab`}
            hidden={inputKind !== "text"}
            className="source-kind-panel"
          >
            <section
              className="source-registration-fields"
              aria-labelledby="source-text-heading"
            >
              <div>
                <h3 id="source-text-heading">글 내용으로 추가</h3>
                <label htmlFor="source-new-text">안내문·메모 내용</label>
                <textarea
                  id="source-new-text"
                  name="text"
                  rows={7}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  placeholder="공지, 과제 안내, 이메일 내용 등을 그대로 붙여 넣어 주세요."
                  aria-describedby="source-text-count"
                />
                <p
                  id="source-text-count"
                  className="small muted source-text-count"
                >
                  {text.length.toLocaleString("ko-KR")}자 입력
                </p>
              </div>
            </section>
          </div>
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
            <button type="submit" disabled={busy || !hydrated}>
              {busy ? "저장 중…" : "저장하고 마감일 확인하기"}
            </button>
          </div>
        </fieldset>
      </form>
    </>
  );
}
