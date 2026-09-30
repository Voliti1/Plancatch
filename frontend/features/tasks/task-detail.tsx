"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { ErrorNotice, Loading } from "@/components/feedback";
import { PageHeading } from "@/components/page-heading";
import { errorMessage } from "@/lib/api/client";
import { useResource } from "@/lib/api/use-resource";
import { formatSeoul } from "@/lib/date/seoul";
import { tasksApi } from "./api";
import { TaskForm } from "./task-form";
export function TaskDetail({ id }: { id: string }) {
  const loader = useCallback(() => tasksApi.get(id), [id]);
  const { data, error, loading, reload } = useResource(loader);
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pending = useRef(false);
  async function toggleCompletion() {
    if (pending.current || !data) return;
    pending.current = true;
    setBusy(true);
    setMutationError("");
    setSaved("");
    try {
      await tasksApi.update(id, { is_completed: !data.is_completed });
      setSaved(
        data.is_completed
          ? "미완료 작업으로 변경했습니다."
          : "작업을 완료했습니다.",
      );
      reload();
    } catch (err) {
      setMutationError(errorMessage(err));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function remove() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMutationError("");
    setSaved("");
    try {
      await tasksApi.remove(id);
      router.replace("/tasks");
    } catch (err) {
      setMutationError(errorMessage(err));
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <Link className="back-link" href="/tasks">
        ← 작업 목록
      </Link>
      <PageHeading
        eyebrow="TASK DETAILS"
        title="작업 상세"
        description="작업 내용을 확인하고 준비 상황을 관리하세요."
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
                {saved}
              </p>
            )}
            <section className="card form-card task-detail">
              <div className="section-header">
                <span className={`tag ${data.is_completed ? "confirmed" : ""}`}>
                  {data.is_completed ? "완료" : "미완료"}
                </span>
                <span className="tag">
                  {data.schedule_type === "fixed" ? "고정 일정" : "유동 작업"}
                </span>
              </div>
              <h2>{data.title}</h2>
              {editing ? (
                <TaskForm
                  initial={data}
                  onCancel={() => setEditing(false)}
                  onSave={async (payload) => {
                    await tasksApi.update(id, payload);
                    setEditing(false);
                    setSaved("변경 사항을 저장했습니다.");
                    reload();
                  }}
                />
              ) : (
                <>
                  <dl className="task-details-grid">
                    <div>
                      <dt>예상 소요시간</dt>
                      <dd>
                        {data.estimated_minutes === null
                          ? "미정"
                          : `${data.estimated_minutes}분`}
                      </dd>
                    </div>
                    <div>
                      <dt>우선순위</dt>
                      <dd>{data.priority}</dd>
                    </div>
                    <div>
                      <dt>가능 시작 일시</dt>
                      <dd>
                        {data.earliest_start
                          ? formatSeoul(data.earliest_start)
                          : "설정 안 함"}
                      </dd>
                    </div>
                    <div>
                      <dt>최종 완료 일시</dt>
                      <dd>
                        {data.latest_end
                          ? formatSeoul(data.latest_end)
                          : "설정 안 함"}
                      </dd>
                    </div>
                    <div>
                      <dt>등록 일시</dt>
                      <dd>{formatSeoul(data.created_at)}</dd>
                    </div>
                    <div>
                      <dt>수정 일시</dt>
                      <dd>{formatSeoul(data.updated_at)}</dd>
                    </div>
                    {data.completed_at && (
                      <div>
                        <dt>완료 일시</dt>
                        <dd>{formatSeoul(data.completed_at)}</dd>
                      </div>
                    )}
                  </dl>
                  <div className="task-description">
                    <h3>작업 설명</h3>
                    <p className="source-text">
                      {data.description || "설명이 없습니다."}
                    </p>
                  </div>
                  <p>
                    {data.deadline_id ? (
                      <Link
                        className="source-detail-link"
                        href={`/deadlines/${encodeURIComponent(data.deadline_id)}`}
                      >
                        연결된 마감일 보기 →
                      </Link>
                    ) : (
                      <span className="muted small">
                        연결된 마감일이 없습니다.
                      </span>
                    )}
                  </p>
                  <div className="form-actions">
                    <button
                      className="secondary"
                      disabled={busy || confirmDelete}
                      onClick={() => {
                        setSaved("");
                        setMutationError("");
                        setEditing(true);
                      }}
                    >
                      작업 수정
                    </button>
                    <button
                      disabled={busy || confirmDelete}
                      onClick={() => void toggleCompletion()}
                    >
                      {busy
                        ? "처리 중…"
                        : data.is_completed
                          ? "미완료로 변경"
                          : "완료 처리"}
                    </button>
                  </div>
                </>
              )}
            </section>
            {!editing && (
              <section className="card danger-zone">
                <div>
                  <h2>작업 삭제</h2>
                  <p className="muted">
                    삭제한 작업은 복구할 수 없습니다. 연결된 마감일은
                    유지됩니다.
                  </p>
                </div>
                {!confirmDelete ? (
                  <button
                    className="danger secondary"
                    disabled={busy}
                    onClick={() => {
                      setMutationError("");
                      setConfirmDelete(true);
                    }}
                  >
                    작업 삭제
                  </button>
                ) : (
                  <div role="group" aria-label="작업 삭제 확인">
                    <p>이 작업을 삭제하시겠습니까?</p>
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
                        onClick={() => void remove()}
                      >
                        {busy ? "삭제 중…" : "삭제 확인"}
                      </button>
                    </div>
                  </div>
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
