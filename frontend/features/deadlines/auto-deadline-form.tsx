"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Loading, ErrorNotice } from "@/components/feedback";
import { PageHeading } from "@/components/page-heading";
import { useAuth } from "@/features/auth/provider";
import { analysisError } from "@/features/analyses/errors";
import { useHydrated } from "@/lib/use-hydrated";
import {
  registerAutomatically,
  type RegistrationDraft,
} from "./automatic-registration";

export function AutoDeadlineForm() {
  const hydrated = useHydrated();
  const { user } = useAuth();
  const entry = useSearchParams().get("new") ?? "direct";
  return hydrated && user ? (
    <RegistrationSession key={`${user.id}:${entry}`} userId={user.id} />
  ) : (
    <Loading />
  );
}

function RegistrationSession({ userId }: { userId: string }) {
  const storageKey = `plancatch.auto-deadline.${userId}`;
  const [draft, setDraft] = useState<RegistrationDraft>({ title: "", url: "" });
  const [resumeDraft, setResumeDraft] = useState<RegistrationDraft | null>(
    () => {
      try {
        const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
        if (
          saved &&
          typeof saved.title === "string" &&
          typeof saved.url === "string" &&
          typeof saved.sourceId === "string" &&
          saved.sourceId.trim() &&
          (saved.analysisId === undefined ||
            typeof saved.analysisId === "string")
        )
          return {
            title: saved.title,
            url: saved.url,
            sourceId: saved.sourceId,
            analysisId: saved.analysisId,
          };
      } catch {
        /* Storage unavailable: the current page can still register. */
      }
      return null;
    },
  );
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [reviewId, setReviewId] = useState("");
  const pending = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const router = useRouter();
  useEffect(() => () => controller.current?.abort(), []);
  function save(next: RegistrationDraft) {
    // A late response from a hidden/unmounted route must not overwrite a new run.
    if (controller.current?.signal.aborted) return;
    setDraft(next);
    setResumeDraft(null);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* No credentials or extracted text are stored. */
    }
  }
  function reset() {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* Optional storage. */
    }
    setDraft({ title: "", url: "" });
    setResumeDraft(null);
    setConsent(false);
    setReviewId("");
    setError("");
    setProgress("");
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || !consent) return;
    const title = draft.title.trim(),
      url = draft.url.trim();
    if (!title) {
      setError("일정 제목을 입력해 주세요.");
      return;
    }
    try {
      const parsed = new URL(url);
      if (
        !["http:", "https:"].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password
      )
        throw new Error();
    } catch {
      setError(
        "로그인 정보가 포함되지 않은 공개 HTTP 또는 HTTPS URL을 입력해 주세요.",
      );
      return;
    }
    pending.current = true;
    setBusy(true);
    setError("");
    const run = new AbortController();
    controller.current = run;
    try {
      const result = await registerAutomatically(
        { ...draft, title, url },
        run.signal,
        save,
        setProgress,
      );
      if (run.signal.aborted) return;
      if (result.kind === "review") {
        setReviewId(result.id);
        setProgress(
          "날짜가 여러 개이거나 확인할 내용이 있어 자동 등록하지 않았습니다. 분석 결과를 검토해 주세요.",
        );
      } else {
        try {
          sessionStorage.removeItem(storageKey);
        } catch {
          /* Optional resume storage. */
        }
        setDraft({ title: "", url: "" });
        setResumeDraft(null);
        setConsent(false);
        setProgress("");
        router.replace(`/deadlines/${encodeURIComponent(result.id)}`);
      }
    } catch (err) {
      if (!run.signal.aborted) setError(analysisError(err));
    } finally {
      pending.current = false;
      // Also release state when a preserved route is hidden and later reopened.
      setBusy(false);
    }
  }
  return (
    <>
      <Link className="back-link" href="/dashboard">
        ← 대시보드
      </Link>
      <PageHeading
        eyebrow="AUTOMATIC DEADLINE"
        title="자동 일정 등록"
        description="제목과 공개 URL을 입력하면 원문을 읽고 마감일을 추출해 등록합니다."
      />
      <form className="card form-card" onSubmit={submit}>
        <fieldset disabled={busy}>
          {resumeDraft && (
            <section className="notice" aria-label="이전 등록 재개">
              <p>
                중단된 등록이 남아 있습니다. 새 일정은 아래에 입력하거나, 이전
                등록을 이어서 진행할 수 있습니다. 기존 서버 자료는 삭제하지
                않습니다.
              </p>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setDraft(resumeDraft);
                  setResumeDraft(null);
                  setConsent(false);
                  setReviewId("");
                  setError("");
                  setProgress("");
                }}
              >
                이전 등록 이어서
              </button>
            </section>
          )}
          <label>
            일정 제목
            <input
              name="title"
              required
              maxLength={255}
              value={draft.title}
              readOnly={!!draft.sourceId}
              onChange={(event) =>
                setDraft({ ...draft, title: event.target.value })
              }
              placeholder="예: 프로젝트 최종 보고서 제출"
            />
          </label>
          <label>
            원본 URL
            <input
              name="url"
              type="url"
              required
              value={draft.url}
              readOnly={!!draft.sourceId}
              onChange={(event) =>
                setDraft({ ...draft, url: event.target.value })
              }
              placeholder="https://…"
            />
          </label>
          <p className="muted small">
            공개 HTML·텍스트 페이지만 지원합니다. 로그인 필요 페이지,
            PDF·이미지, JavaScript 실행이 필요한 페이지는 읽지 않습니다.
          </p>
          <p className="notice">
            명확한 마감일 후보가 하나일 때 입력한 제목으로 자동 등록합니다. 여러
            후보·날짜 누락·AI 주의사항이 있으면 검토 화면에서 직접 확인합니다.
            작업 생성·자동 배치·Google Calendar 동기화는 하지 않습니다. AI
            추출에는 오류가 있을 수 있으니 등록된 날짜를 원문과 확인해 주세요.
          </p>
          <label className="checkbox analysis-consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>
              추출 원문 전체를 Google Gemini로 전송하고, 명확한 마감일 하나를
              자동 등록하는 데 동의합니다.
            </span>
          </label>
          {draft.sourceId && !busy && (
            <p className="small muted">
              이전에 시작한 자료를 이어서 처리합니다. 제목과 URL은 유지되며, 새
              자료를 중복 생성하지 않습니다.
            </p>
          )}
          {progress && (
            <p role="status" aria-live="polite">
              {progress}
            </p>
          )}
          {error && <ErrorNotice message={error} />}
          {reviewId ? (
            <Link
              className="button"
              href={`/analyses/${encodeURIComponent(reviewId)}`}
            >
              AI 결과 검토하기 →
            </Link>
          ) : (
            <button type="submit" disabled={!consent}>
              {busy
                ? "일정 등록 중…"
                : draft.sourceId
                  ? "이어서 등록"
                  : "일정 등록"}
            </button>
          )}
        </fieldset>
      </form>
      {draft.sourceId && (
        <p>
          <Link
            className="source-detail-link"
            href={`/sources/${encodeURIComponent(draft.sourceId)}`}
          >
            저장된 원본 자료 확인 →
          </Link>
          {draft.analysisId && (
            <>
              {" "}
              ·{" "}
              <Link href={`/analyses/${encodeURIComponent(draft.analysisId)}`}>
                분석 상태 확인 →
              </Link>
            </>
          )}
        </p>
      )}
      {draft.sourceId && !busy && (
        <button className="secondary" onClick={reset}>
          다른 일정 입력
        </button>
      )}
    </>
  );
}
