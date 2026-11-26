"use client";
import { useScheduleTime } from "@/features/settings/time-zone";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { useAuth } from "@/features/auth/provider";
import {
  hasPdfScanConsent,
  setPdfScanConsent,
  subscribePdfScanConsent,
} from "@/features/settings/pdf-scan-consent";
import { ErrorNotice, Loading } from "@/components/feedback";
import { PageHeading } from "@/components/page-heading";
import { ApiError, errorMessage } from "@/lib/api/client";
import { useResource } from "@/lib/api/use-resource";
import { sourcesApi } from "./api";
import { processingStatusLabel, sourceTypeLabel } from "./display";
import { SourceEditForm } from "./source-edit-form";
import type { Source } from "@/types/api";
import { SourceExtraction } from "./source-extraction";
import { processingError } from "@/features/analyses/errors";
import { SourceAnalyses } from "@/features/analyses/source-analyses";
import { SourceExtractedContent } from "./source-extracted-content";
import { SourceImage } from "./source-image";
import { extractedSummary } from "./extracted-summary";

export function SourceDetail({ id }: { id: string }) {
  const { formatLocal } = useScheduleTime();
  const userId = useAuth().user?.id;
  const savedPdfConsent = useSyncExternalStore(
    subscribePdfScanConsent,
    () => hasPdfScanConsent(userId),
    () => false,
  );
  const loader = useCallback(async () => {
    try {
      return await sourcesApi.get(id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404)
        throw new Error(
          "자료를 찾을 수 없어요. 삭제되었거나 접근할 수 없는 자료예요.",
        );
      throw err;
    }
  }, [id]);
  const { data: loaded, loading, error, reload } = useResource(loader);
  const [sourceUpdate, setSourceUpdate] = useState<Source>();
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const data = sourceUpdate ?? loaded;
  const pdf = data?.source_type === "pdf";
  const extractedTitle =
    pdf && data?.extracted_text
      ? extractedSummary(data.extracted_text, true).title
      : null;
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const deletePending = useRef(false);

  async function remove() {
    if (deletePending.current) return;
    deletePending.current = true;
    setDeleting(true);
    setDeleteError("");
    try {
      await sourcesApi.remove(id);
      router.replace("/sources");
    } catch (err) {
      setDeleteError(errorMessage(err));
      deletePending.current = false;
      setDeleting(false);
    }
  }

  return (
    <>
      <Link className="back-link" href="/sources">
        ← 자료 목록
      </Link>
      <PageHeading
        eyebrow="자료 상세"
        title="자료 상세"
        description="저장한 자료의 내용을 확인하고 관리하세요."
      />
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorNotice message={error} retry={reload} />
      ) : (
        data && (
          <>
            {saved && (
              <p className="success" role="status">
                변경 사항을 저장했어요.
              </p>
            )}
            <section
              className={`card form-card source-detail${pdf ? " pdf-source-detail" : ""}`}
            >
              <div className="section-header">
                <span className="tag">{sourceTypeLabel(data.source_type)}</span>
                <span className="tag">
                  {processingStatusLabel(data.processing_status)}
                </span>
              </div>
              <h2>{data.title || extractedTitle || "제목 없는 자료"}</h2>
              <dl className="source-metadata">
                {data.original_filename && (
                  <div>
                    <dt>원본 파일명</dt>
                    <dd>{data.original_filename}</dd>
                  </div>
                )}
                <div>
                  <dt>등록 일시</dt>
                  <dd>{formatLocal(data.created_at)}</dd>
                </div>
                <div>
                  <dt>수정 일시</dt>
                  <dd>{formatLocal(data.updated_at)}</dd>
                </div>
              </dl>
              {data.error_message && (
                <ErrorNotice message={processingError(data.error_message)} />
              )}
              {editing ? (
                <SourceEditForm
                  initial={data}
                  onCancel={() => setEditing(false)}
                  onSave={async (payload) => {
                    await sourcesApi.update(id, payload);
                    setEditing(false);
                    setSaved(true);
                    setSourceUpdate(undefined);
                    reload();
                  }}
                />
              ) : (
                <>
                  {data.original_url && (
                    <section className="source-content">
                      <h3>웹페이지 링크</h3>
                      {/^https?:\/\//i.test(data.original_url) ? (
                        <a
                          className="source-link"
                          href={data.original_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {data.original_url} ↗
                        </a>
                      ) : (
                        <p className="source-text">{data.original_url}</p>
                      )}
                    </section>
                  )}
                  {data.original_text !== null &&
                    !(
                      data.source_type === "text" &&
                      data.original_text === data.extracted_text
                    ) && (
                      <section className="source-content">
                        <h3>글 내용</h3>
                        <p className="source-text">
                          {data.original_text || "저장된 텍스트가 없어요."}
                        </p>
                      </section>
                    )}
                  {data.extracted_text !== null && (
                    <SourceExtractedContent
                      text={data.extracted_text}
                      pdf={pdf}
                      fileMetadata={data.file_metadata}
                    />
                  )}
                  {data.source_type === "url" || data.source_type === "text" ? (
                    <button
                      className="secondary"
                      disabled={
                        confirmDelete ||
                        deleting ||
                        workflowBusy ||
                        data.processing_status === "processing"
                      }
                      onClick={() => {
                        setSaved(false);
                        setEditing(true);
                      }}
                    >
                      자료 수정
                    </button>
                  ) : (
                    <p className="muted small">
                      이 자료 유형의 수정은 아직 지원하지 않아요.
                    </p>
                  )}
                </>
              )}
            </section>
            {data.source_type === "image" || data.source_type === "pdf" ? (
              <>
                {data.source_type === "image" && <SourceImage id={id} />}
                <div className={pdf ? "pdf-source-review-actions" : undefined}>
                  <Link
                    className="button"
                    href={`/sources/${encodeURIComponent(id)}/review`}
                  >
                    {pdf ? "PDF" : "이미지"} 마감일 검토 →
                  </Link>
                  {pdf && savedPdfConsent && userId && (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setPdfScanConsent(userId, false)}
                    >
                      저장된 스캔 PDF 동의 끄기
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <SourceExtraction
                  source={data}
                  disabled={
                    editing || confirmDelete || deleting || workflowBusy
                  }
                  onUpdate={setSourceUpdate}
                  onBusy={setWorkflowBusy}
                />
                <SourceAnalyses
                  source={data}
                  disabled={
                    editing || confirmDelete || deleting || workflowBusy
                  }
                  onBusy={setWorkflowBusy}
                />
              </>
            )}
            {!editing && (
              <section className="card danger-zone">
                <div>
                  <h2>자료 삭제</h2>
                  <p className="muted">삭제한 자료는 복구할 수 없어요.</p>
                  <p className="muted">
                    마감일이 등록된 자료는 삭제할 수 없어요. 연결된 마감일을
                    먼저 삭제해 주세요.
                  </p>
                </div>
                {!confirmDelete ? (
                  <button
                    className="danger secondary"
                    disabled={
                      workflowBusy || data.processing_status === "processing"
                    }
                    onClick={() => {
                      setDeleteError("");
                      setConfirmDelete(true);
                    }}
                  >
                    자료 삭제
                  </button>
                ) : (
                  <div role="group" aria-label="자료 삭제 확인">
                    <p>이 자료를 삭제할까요?</p>
                    <div className="form-actions">
                      <button
                        className="secondary"
                        disabled={deleting}
                        onClick={() => {
                          setConfirmDelete(false);
                          setDeleteError("");
                        }}
                      >
                        취소
                      </button>
                      <button
                        className="danger"
                        disabled={deleting}
                        onClick={() => void remove()}
                      >
                        {deleting ? "삭제 중…" : "삭제 확인"}
                      </button>
                    </div>
                  </div>
                )}
                {deleteError && <ErrorNotice message={deleteError} />}
              </section>
            )}
          </>
        )
      )}
    </>
  );
}
