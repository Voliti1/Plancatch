"use client";
import Link from "next/link";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { deadlinesApi } from "./api";
import { DeadlineForm } from "./deadline-form";
import { useResource } from "@/lib/api/use-resource";
import { errorMessage } from "@/lib/api/client";
import { formatSeoul } from "@/lib/date/seoul";
import { ErrorNotice, Loading } from "@/components/feedback";
import { PageHeading } from "@/components/page-heading";
export function DeadlineDetail({ id }: { id: string }) {
  const loader = useCallback(() => deadlinesApi.get(id), [id]);
  const { data, loading, error, reload } = useResource(loader);
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [saved, setSaved] = useState(false);
  if (loading) return <Loading />;
  if (error) return <ErrorNotice message={error} retry={reload} />;
  if (!data) return null;
  return (
    <>
      <Link className="back-link" href="/deadlines">
        ← 마감일 목록
      </Link>
      <PageHeading
        eyebrow="DEADLINE DETAILS"
        title="마감일 상세"
        description={`등록 ${formatSeoul(data.created_at)} · 모든 시간은 한국 시간입니다.`}
      />
      <section className="card form-card">
        <h2>{data.title}</h2>
        {saved && (
          <p className="success" role="status">
            변경 사항을 저장했습니다.
          </p>
        )}
        <DeadlineForm
          initial={data}
          onSave={async (payload) => {
            await deadlinesApi.update(id, payload);
            setSaved(true);
            reload();
          }}
        />
        {data.evidence_text && (
          <div className="notice">
            <h3>분석 근거</h3>
            <p className="source-text">{data.evidence_text}</p>
          </div>
        )}
      </section>
      <section className="card danger-zone">
        <div>
          <h2>마감일 삭제</h2>
          <p className="muted">삭제한 마감일은 복구할 수 없습니다.</p>
        </div>
        {!confirm ? (
          <button className="danger secondary" onClick={() => setConfirm(true)}>
            삭제
          </button>
        ) : (
          <div role="group" aria-label="삭제 확인">
            <p>이 마감일을 삭제하시겠습니까?</p>
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
