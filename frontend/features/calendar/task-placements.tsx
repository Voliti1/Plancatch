"use client";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { Empty, ErrorNotice, Loading } from "@/components/feedback";
import { ApiError, errorMessage } from "@/lib/api/client";
import { useResource } from "@/lib/api/use-resource";
import { formatSeoul, toSeoulInput } from "@/lib/date/seoul";
import type { ScheduledEvent } from "@/types/scheduled-event";
import type { Task } from "@/types/task";
import { eventsApi } from "./api";
import { lockedEvent, statusLabel } from "./dates";
import { EventForm } from "./event-form";
import "./calendar.css";
import { GoogleExportPanel } from "@/features/google-calendar/export-panel";

export function TaskPlacements({ task }: { task: Task }) {
  const load = useCallback(
    (signal: AbortSignal) => eventsApi.all({ task_id: task.id }, signal),
    [task.id],
  );
  const { data, loading, error, reload } = useResource(load);
  const [editor, setEditor] = useState<ScheduledEvent | "new" | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const pending = useRef(false);
  async function remove(id: string) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMutationError("");
    setMessage("");
    try {
      await eventsApi.remove(id);
      setConfirmation(null);
      setMessage("캘린더 배치를 삭제했습니다. 일정 내용은 유지됩니다.");
      reload();
    } catch (error) {
      setMutationError(errorMessage(error));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className="card task-placements"
      id="calendar-placements"
      aria-labelledby="placements-title"
    >
      <div className="section-header">
        <h2 id="placements-title">캘린더 배치</h2>
        <Link href="/calendar">캘린더 보기 →</Link>
      </div>
      <p className="small muted">
        배치 버튼으로 확정한 시간만 플랜캐치 캘린더에 저장합니다. Google에는
        아래 전송 미리보기에서 확인한 뒤 별도로 등록합니다.
      </p>
      {message && (
        <p role="status" className="success">
          {message}
        </p>
      )}
      {mutationError && <ErrorNotice message={mutationError} retry={reload} />}
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorNotice message={error} retry={reload} />
      ) : (
        data && (
          <>
            {data.hasMore && (
              <p role="status">
                배치 내역이 많아 첫 2,000건을 표시합니다. 전체 조회를 위한 API
                협의가 필요합니다.
              </p>
            )}
            {data.events.length ? (
              <ul className="placement-list">
                {data.events.map((event) => (
                  <li key={event.id}>
                    <div className="placement-summary">
                      <span className={`tag event-${event.status}`}>
                        {statusLabel[event.status]}
                      </span>
                      <p>
                        <time dateTime={event.start_at}>
                          {formatSeoul(event.start_at)}
                        </time>
                        {" → "}
                        <time dateTime={event.end_at}>
                          {formatSeoul(event.end_at)}
                        </time>
                      </p>
                      <Link
                        href={`/calendar?date=${toSeoulInput(event.start_at).slice(0, 10)}`}
                      >
                        배치 날짜 보기 →
                      </Link>
                    </div>
                    {lockedEvent(event) ? (
                      <p className="small muted">
                        동기화된 일정은 여기서 변경할 수 없습니다.
                      </p>
                    ) : (
                      !editor && (
                        <div className="placement-actions">
                          <button
                            className="secondary"
                            disabled={busy || confirmation !== null}
                            onClick={() => {
                              setUncertain(false);
                              setEditor(event);
                              setMutationError("");
                              setMessage("");
                            }}
                          >
                            배치 수정
                          </button>
                          <button
                            className="secondary danger"
                            disabled={busy || confirmation !== null}
                            onClick={() => setConfirmation(event.id)}
                          >
                            배치 삭제
                          </button>
                        </div>
                      )
                    )}
                    {confirmation === event.id && (
                      <div role="group" aria-label="배치 삭제 확인">
                        <p>이 배치만 삭제합니다. 연결된 일정은 유지됩니다.</p>
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() => setConfirmation(null)}
                        >
                          취소
                        </button>{" "}
                        <button
                          className="danger"
                          disabled={busy}
                          onClick={() => void remove(event.id)}
                        >
                          {busy ? "삭제 중…" : "배치 삭제 확인"}
                        </button>
                      </div>
                    )}
                    {event.status === "approved" &&
                      !editor &&
                      !confirmation && (
                        <GoogleExportPanel
                          key={`${event.id}-${event.updated_at}`}
                          kind="event"
                          itemId={event.id}
                          disabled={busy}
                        />
                      )}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty title="캘린더에 배치된 시간이 없습니다">
                가능 기간을 확인한 뒤 원하는 시간을 배치하세요.
              </Empty>
            )}
            {!editor && (
              <button
                disabled={busy || confirmation !== null}
                onClick={() => {
                  setEditor("new");
                  setUncertain(false);
                  setMutationError("");
                  setMessage("");
                }}
              >
                캘린더에 배치
              </button>
            )}
          </>
        )
      )}
      {editor && (
        <EventForm
          key={editor === "new" ? "new" : editor.id}
          task={task}
          initial={editor === "new" ? undefined : editor}
          blocked={uncertain || loading || Boolean(error)}
          onCancel={() => setEditor(null)}
          onSave={async (input) => {
            setMessage("");
            setMutationError("");
            try {
              if (editor === "new")
                await eventsApi.create({ task_id: task.id, ...input });
              else await eventsApi.update(editor.id, input);
              setEditor(null);
              setMessage("캘린더 배치를 저장했습니다.");
              reload();
            } catch (error) {
              if (
                editor === "new" &&
                error instanceof ApiError &&
                (error.status === 0 || error.status >= 500)
              ) {
                setUncertain(true);
                throw new Error(
                  `${errorMessage(error)} 저장 여부가 불확실하므로 다시 저장하지 않습니다. 배치 내역을 확인한 뒤 새 배치를 시작해 주세요.`,
                );
              }
              throw error;
            }
          }}
        />
      )}
      {editor && (
        <button type="button" className="text-button" onClick={reload}>
          배치 내역 다시 불러오기
        </button>
      )}
    </section>
  );
}
