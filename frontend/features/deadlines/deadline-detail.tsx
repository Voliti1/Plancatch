"use client";
import { useScheduleTime } from "@/features/settings/time-zone";
import Link from "next/link";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { deadlinesApi } from "./api";
import { DeadlineForm } from "./deadline-form";
import { DeadlineTimes } from "./deadline-times";
import { DeadlineReadiness } from "./deadline-readiness";
import { useResource } from "@/lib/api/use-resource";
import { errorMessage } from "@/lib/api/client";
import { ErrorNotice, Loading } from "@/components/feedback";
import { PageHeading } from "@/components/page-heading";
import { CategoryBadge } from "@/components/category-badge";
import { DeadlineDday } from "@/components/deadline-dday";
import "@/features/tasks/detail-pages.css";
import { DeadlineTasks } from "@/features/tasks/deadline-tasks";
import { GoogleExportPanel } from "@/features/google-calendar/export-panel";
export function DeadlineDetail({ id }: { id: string }) {
  const { formatLocal, zoneLabel } = useScheduleTime();
  const loader = useCallback(() => deadlinesApi.get(id), [id]);
  const { data, loading, error, reload } = useResource(loader);
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [saved, setSaved] = useState(false);
  const [workVersion, setWorkVersion] = useState(0);
  const [editing, setEditing] = useState(false);
  if (loading) return <Loading />;
  if (error) return <ErrorNotice message={error} retry={reload} />;
  if (!data) return null;
  return (
    <>
      <Link className="back-link" href="/deadlines">
        ← 마감일·할 일 목록
      </Link>
      <PageHeading
        eyebrow="DEADLINE DETAILS"
        title="일정 상세"
        description={`등록 ${formatLocal(data.created_at)} · 표시 시간대 ${zoneLabel}`}
      />
      <section
        className="card form-card deadline-detail-summary"
        aria-label="마감일 요약"
      >
        <div className="detail-summary-heading">
          <div className="detail-badges">
            <DeadlineDday due={data.due_at} />
            <CategoryBadge value={data.category} />
          </div>
          {!editing && (
            <button
              className="secondary"
              disabled={deleting || confirm}
              onClick={() => {
                setSaved(false);
                setEditing(true);
              }}
            >
              수정
            </button>
          )}
        </div>
        <h2>{data.title}</h2>
        <DeadlineTimes deadline={data} />
        {saved && (
          <p className="success" role="status">
            변경 사항을 저장했어요.
          </p>
        )}
        {editing ? (
          <DeadlineForm
            initial={data}
            onCancel={() => setEditing(false)}
            onSave={async (payload) => {
              await deadlinesApi.update(id, payload);
              setSaved(true);
              setEditing(false);
              reload();
            }}
          />
        ) : data.description ? (
          <div className="task-description">
            <h3>메모</h3>
            <p className="source-text">{data.description}</p>
          </div>
        ) : null}
        {(data.evidence_text || data.source_id) && (
          <details className="notice">
            <summary>원문에서 찾은 근거 보기</summary>
            {data.evidence_text && (
              <p className="source-text">{data.evidence_text}</p>
            )}
            {data.source_id && (
              <Link
                className="source-detail-link"
                href={`/sources/${encodeURIComponent(data.source_id)}`}
              >
                원본 자료 보기 →
              </Link>
            )}
          </details>
        )}
      </section>
      <DeadlineTasks
        deadlineId={id}
        onUpdated={() => setWorkVersion((v) => v + 1)}
      />
      <DeadlineReadiness
        key={`${id}-${data.updated_at}-${workVersion}`}
        id={id}
      />
      <GoogleExportPanel
        key={`${id}-${data.updated_at}`}
        kind="deadline"
        itemId={id}
        disabled={deleting || confirm || editing}
      />
      <section className="card danger-zone">
        <div>
          <h2>마감일 삭제</h2>
          <p className="muted">
            마감일과 플랜캐치가 등록한 구글 캘린더 일정은 삭제되며 복구할 수
            없어요. 연결된 할 일은 유지돼요. 다른 마감일에서 쓰지 않는 자료·검토
            기록만 함께 삭제돼요.
          </p>
        </div>
        {!confirm ? (
          <button
            className="danger secondary"
            disabled={editing}
            onClick={() => setConfirm(true)}
          >
            삭제
          </button>
        ) : (
          <div role="group" aria-label="삭제 확인">
            <p>이 마감일을 삭제할까요?</p>
            <div className="form-actions">
              <button
                className="secondary"
                disabled={deleting}
                onClick={() => setConfirm(false)}
              >
                취소
              </button>
              <button
                className="danger"
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  setDeleteError("");
                  try {
                    await deadlinesApi.remove(id);
                    router.replace("/deadlines");
                  } catch (err) {
                    setDeleteError(errorMessage(err));
                    setDeleting(false);
                  }
                }}
              >
                {deleting ? "삭제 중…" : "삭제 확인"}
              </button>
            </div>
          </div>
        )}
        {deleteError && <ErrorNotice message={deleteError} />}
      </section>
    </>
  );
}
