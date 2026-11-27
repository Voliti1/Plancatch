"use client";
import { useScheduleTime } from "@/features/settings/time-zone";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { ErrorNotice, Loading } from "@/components/feedback";
import { PageHeading } from "@/components/page-heading";
import { CategoryBadge } from "@/components/category-badge";
import { errorMessage } from "@/lib/api/client";
import { useResource } from "@/lib/api/use-resource";
import { tasksApi } from "./api";
import { TaskForm } from "./task-form";
import { GoogleExportPanel } from "@/features/google-calendar/export-panel";
import "./schedule-overview.css";
import "./detail-pages.css";
import { reminderSummary } from "@/features/google-calendar/reminder-settings";
import { recurrenceSummary } from "./recurrence-settings";
export function TaskDetail({
  id,
  startEditing = false,
}: {
  id: string;
  startEditing?: boolean;
}) {
  const { formatLocal } = useScheduleTime();
  const loader = useCallback(() => tasksApi.get(id), [id]);
  const { data, error, loading, reload } = useResource(loader);
  const startsAt = data?.placement?.start_at ?? data?.earliest_start;
  const endsAt = data?.placement?.end_at ?? data?.latest_end;
  const hasReminder = Boolean(
    data?.google_reminders &&
    (data.google_reminders.mode === "default" ||
      (data.google_reminders.mode === "custom" &&
        data.google_reminders.overrides.length > 0)),
  );
  const router = useRouter();
  const [editing, setEditing] = useState(startEditing);
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pending = useRef(false);
  async function remove() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMutationError("");
    setSaved("");
    try {
      await tasksApi.remove(id);
      router.replace("/deadlines");
    } catch (err) {
      setMutationError(errorMessage(err));
      pending.current = false;
      setBusy(false);
    }
  }
  async function toggleComplete() {
    if (!data || pending.current || editing || confirmDelete) return;
    pending.current = true;
    setBusy(true);
    setMutationError("");
    setSaved("");
    try {
      await tasksApi.update(id, { is_completed: !data.is_completed });
      setSaved(
        data.is_completed ? "미완료로 변경했어요." : "완료로 표시했어요.",
      );
      reload();
    } catch (err) {
      setMutationError(errorMessage(err));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <div className="schedule-detail-navigation">
        <Link className="back-link" href="/deadlines">
          ← 마감일·할 일 목록
        </Link>
      </div>
      <PageHeading
        eyebrow="일정 상세"
        title="일정 상세"
        description="일정과 메모를 확인하고 필요한 내용을 수정하세요."
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
            {mutationError && !confirmDelete && (
              <ErrorNotice message={mutationError} />
            )}
            <section className="card form-card task-detail schedule-detail">
              <div className="detail-summary-heading">
                <div className="detail-badges">
                  <span
                    className={`tag ${data.is_completed ? "confirmed" : ""}`}
                  >
                    {data.is_completed ? "완료" : "미완료"}
                  </span>
                  <span className="tag">
                    {data.schedule_type === "fixed"
                      ? "시간이 정해진 일정"
                      : "시간 미정 할 일"}
                  </span>
                  <CategoryBadge value={data.category} />
                </div>
                {!editing && (
                  <button
                    className="secondary"
                    disabled={busy || confirmDelete}
                    onClick={() => void toggleComplete()}
                  >
                    {busy && !confirmDelete
                      ? "변경 중…"
                      : data.is_completed
                        ? "미완료로 변경"
                        : "완료 처리"}
                  </button>
                )}
              </div>
              <h2>{data.title}</h2>
              {data.series_id && (
                <p className="notice">
                  반복 일정에서 개별 변경한 일정이에요.{" "}
                  <Link href={`/tasks/${encodeURIComponent(data.series_id)}`}>
                    전체 반복 설정 보기 →
                  </Link>
                </p>
              )}
              {editing ? (
                <>
                  {data.placement && (
                    <p className="small muted">
                      아래 시작·종료 일시는 작업이 가능한 기간이에요. 캘린더에
                      등록한 시간을 바꾸려면 등록한 시간을 다시 추천받으세요.
                    </p>
                  )}
                  <TaskForm
                    initial={data}
                    variant="calendar"
                    onCancel={() => setEditing(false)}
                    onSave={async (payload) => {
                      await tasksApi.update(id, payload);
                      setEditing(false);
                      setSaved("변경 사항을 저장했어요.");
                      reload();
                    }}
                  />
                </>
              ) : (
                <>
                  <dl className="task-details-grid">
                    <div>
                      <dt>
                        {data.placement ? "시간 등록 시작 일시" : "시작 일시"}
                      </dt>
                      <dd>
                        {startsAt ? (
                          <time dateTime={startsAt}>
                            {formatLocal(startsAt)}
                          </time>
                        ) : (
                          "설정 안 함"
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>
                        {data.placement ? "시간 등록 종료 일시" : "종료 일시"}
                      </dt>
                      <dd>
                        {endsAt ? (
                          <time dateTime={endsAt}>{formatLocal(endsAt)}</time>
                        ) : (
                          "설정 안 함"
                        )}
                      </dd>
                    </div>
                  </dl>
                  {data.placement_blocks &&
                    data.placement_blocks.length > 1 && (
                      <div className="task-description">
                        <h3>캘린더에 등록한 시간</h3>
                        <ul>
                          {data.placement_blocks.map((block) => (
                            <li key={block.id}>
                              <time dateTime={block.start_at}>
                                {formatLocal(block.start_at)}
                              </time>
                              {" → "}
                              <time dateTime={block.end_at}>
                                {formatLocal(block.end_at)}
                              </time>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  <div className="task-description">
                    <h3>메모</h3>
                    <p className="source-text">
                      {data.description || "메모가 없어요."}
                    </p>
                  </div>
                  <details className="schedule-extra-details">
                    <summary>상세 정보</summary>
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
                        <dt>등록 일시</dt>
                        <dd>{formatLocal(data.created_at)}</dd>
                      </div>
                      <div>
                        <dt>수정 일시</dt>
                        <dd>{formatLocal(data.updated_at)}</dd>
                      </div>
                      {data.completed_at && (
                        <div>
                          <dt>완료 일시</dt>
                          <dd>{formatLocal(data.completed_at)}</dd>
                        </div>
                      )}
                    </dl>
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
                          연결된 마감일이 없어요.
                        </span>
                      )}
                    </p>
                    {!data.recurrence && (
                      <p className="small">
                        반복: {recurrenceSummary(data.recurrence)}
                      </p>
                    )}
                    {!hasReminder && (
                      <p className="small">
                        구글 캘린더 알림:{" "}
                        {reminderSummary(data.google_reminders)}
                      </p>
                    )}
                  </details>
                  {data.recurrence && (
                    <>
                      <p className="small">
                        반복: {recurrenceSummary(data.recurrence)}
                      </p>
                      {data.recurrence && (
                        <p className="small muted">
                          개별 변경·삭제 {data.exception_count ?? 0}회. 종료일을
                          앞당기면 그 이후의 개별 변경도 함께 제외돼요.
                        </p>
                      )}
                    </>
                  )}
                  {hasReminder && (
                    <p className="small">
                      구글 캘린더 알림: {reminderSummary(data.google_reminders)}
                    </p>
                  )}
                  <div className="form-actions">
                    {data.schedule_type === "flexible" &&
                      !data.is_completed &&
                      Boolean(data.estimated_minutes) && (
                        <Link
                          className="button"
                          href={`/planning?task=${encodeURIComponent(data.id)}${data.placement ? "&mode=replan" : ""}`}
                        >
                          {data.placement
                            ? "등록한 시간 다시 추천받기"
                            : "자동 시간 추천받기"}
                        </Link>
                      )}
                    <button
                      className="secondary"
                      disabled={busy || confirmDelete}
                      onClick={() => {
                        setSaved("");
                        setMutationError("");
                        setEditing(true);
                      }}
                    >
                      일정 수정
                    </button>
                  </div>
                </>
              )}
            </section>
            {!editing && (
              <GoogleExportPanel
                key={`${id}-${data.updated_at}`}
                kind="task"
                itemId={id}
                disabled={busy || confirmDelete}
              />
            )}
            {!editing && (
              <section className="card danger-zone schedule-detail-danger">
                <div>
                  <h2>일정 삭제</h2>
                  <p className="muted">
                    {data.recurrence &&
                      "이 반복 일정 전체와 구글 캘린더에 연결된 반복 일정이 삭제돼요. "}
                    삭제한 일정은 복구할 수 없어요. 연결된 마감일은 유지돼요.
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
                    일정 삭제
                  </button>
                ) : (
                  <div role="group" aria-label="일정 삭제 확인">
                    <p>이 일정을 삭제할까요?</p>
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
            {mutationError && confirmDelete && (
              <ErrorNotice message={mutationError} />
            )}
          </>
        )
      )}
    </>
  );
}
