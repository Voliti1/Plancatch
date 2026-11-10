"use client";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorNotice, Loading } from "@/components/feedback";
import { PageHeading } from "@/components/page-heading";
import { useResource } from "@/lib/api/use-resource";
import { errorMessage } from "@/lib/api/client";
import { formatSeoul } from "@/lib/date/seoul";
import { tasksApi } from "./api";
import { TaskForm } from "./task-form";

export function OccurrenceDetail({ id, at }: { id: string; at: string }) {
  const loader = useCallback(() => tasksApi.occurrence(id, at), [id, at]);
  const { data, loading, error, reload } = useResource(loader);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState("");
  const pending = useRef(false);
  const router = useRouter();
  return (
    <>
      <Link className="back-link" href="/calendar">
        ← 캘린더
      </Link>
      <PageHeading
        eyebrow="REPEATING SCHEDULE"
        title="반복 일정 상세"
        description="선택한 날짜의 일정만 수정하거나 삭제할 수 있습니다."
      />
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorNotice message={error} retry={reload} />
      ) : (
        data && (
          <>
            <section className="card form-card">
              <h2>{data.title}</h2>
              <p className="small muted">원래 회차: {formatSeoul(at)}</p>
              <p className="notice">
                ‘이번 일정만’ 변경하면 다른 날짜의 일정과 반복 종료일은
                유지됩니다.
              </p>
              {editing ? (
                <TaskForm
                  initial={data}
                  variant="calendar"
                  onCancel={() => setEditing(false)}
                  onSave={async (payload) => {
                    await tasksApi.updateOccurrence(id, at, payload);
                    setEditing(false);
                    reload();
                  }}
                />
              ) : (
                <>
                  <p>
                    {formatSeoul(data.earliest_start!)} ~{" "}
                    {formatSeoul(data.latest_end!)}
                  </p>
                  <p className="source-text">
                    {data.description || "메모가 없습니다."}
                  </p>
                  <div className="form-actions">
                    <button
                      disabled={busy || confirmDelete}
                      onClick={() => setEditing(true)}
                    >
                      이번 일정만 수정
                    </button>
                    <Link
                      className="button secondary"
                      href={`/tasks/${encodeURIComponent(id)}`}
                    >
                      전체 반복 수정
                    </Link>
                  </div>
                </>
              )}
            </section>
            {!editing && (
              <section className="card danger-zone">
                <div>
                  <h2>이번 일정 삭제</h2>
                  <p>
                    선택한 날짜의 일정만 삭제합니다. 나머지 반복 일정은
                    유지됩니다.
                  </p>
                </div>
                {confirmDelete ? (
                  <div role="group" aria-label="이번 일정 삭제 확인">
                    <p>이 날짜의 일정만 삭제하시겠습니까?</p>
                    <div className="form-actions">
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => {
                          setConfirmDelete(false);
                          setMutationError("");
                        }}
                      >
                        취소
                      </button>
                      <button
                        className="danger"
                        disabled={busy}
                        onClick={async () => {
                          if (pending.current) return;
                          pending.current = true;
                          setBusy(true);
                          setMutationError("");
                          try {
                            await tasksApi.removeOccurrence(id, at);
                            router.replace("/calendar");
                          } catch (error) {
                            setMutationError(errorMessage(error));
                            pending.current = false;
                            setBusy(false);
                          }
                        }}
                      >
                        {busy ? "삭제 중…" : "이번 일정 삭제 확인"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="danger secondary"
                    onClick={() => setConfirmDelete(true)}
                  >
                    이번 일정만 삭제
                  </button>
                )}
              </section>
            )}
            {mutationError && <ErrorNotice message={mutationError} />}
          </>
        )
      )}
    </>
  );
}
