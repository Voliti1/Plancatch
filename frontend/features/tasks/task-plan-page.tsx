"use client";
import { useScheduleTime } from "@/features/settings/time-zone";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { PageHeading } from "@/components/page-heading";
import { ErrorNotice, Loading } from "@/components/feedback";
import { api, errorMessage } from "@/lib/api/client";
import { useResource } from "@/lib/api/use-resource";
import { useUnsavedChanges } from "@/lib/unsaved-changes";
import { seoulInputToUtc, toSeoulInput } from "@/lib/date/seoul";
import type { Deadline } from "@/types/api";
import "../calendar/auto-schedule.css";

type Candidate = {
  id: string;
  title: string;
  description: string;
  estimated_minutes: number;
  priority: number;
  latest_end: string;
  selected: boolean;
  depends_on: string[];
};
type Proposal = {
  id: string;
  revision: number;
  status: "ready" | "approved" | "rejected";
  candidates: Candidate[];
  warnings: string[];
  approved_task_ids: string[];
  created_at: string;
};
const path = (id: string) => `/api/task-proposals/${encodeURIComponent(id)}`;

export function TaskPlanPage({ id }: { id: string }) {
  const load = useResource(
    useCallback(
      async (signal: AbortSignal) => {
        const deadline = await api<Deadline>(
          `/api/deadlines/${encodeURIComponent(id)}`,
          { signal },
        );
        const history = await api<{ entries: Proposal[]; has_more: boolean }>(
          `/api/deadlines/${encodeURIComponent(id)}/task-proposals`,
          { signal },
        );
        return { deadline, history };
      },
      [id],
    ),
  );
  if (load.loading) return <Loading />;
  if (load.error)
    return <ErrorNotice message={load.error} retry={load.reload} />;
  return load.data && <Planner key={id} id={id} initial={load.data} />;
}

function Planner({
  id,
  initial,
}: {
  id: string;
  initial: {
    deadline: Deadline;
    history: { entries: Proposal[]; has_more: boolean };
  };
}) {
  const { formatLocal } = useScheduleTime();
  const [notes, setNotes] = useState("");
  const [consent, setConsent] = useState(false);
  const [history, setHistory] = useState(initial.history.entries);
  const [more, setMore] = useState(initial.history.has_more);
  const [plan, setPlan] = useState<Proposal | null>(null);
  const [draft, setDraft] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef(false),
    request = useRef<string | null>(null);
  const guard = useUnsavedChanges(
    JSON.stringify(draft),
    plan?.status === "ready",
  );
  const notesGuard = useUnsavedChanges(notes);
  function show(value: Proposal) {
    setPlan(value);
    setDraft(value.candidates);
    guard.markSaved(JSON.stringify(value.candidates));
  }
  function change(index: number, value: Partial<Candidate>) {
    setDraft((items) =>
      items.map((c, i) => (i === index ? { ...c, ...value } : c)),
    );
    setError("");
  }
  async function action(work: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function refreshHistory() {
    const page = await api<{ entries: Proposal[]; has_more: boolean }>(
      `/api/deadlines/${encodeURIComponent(id)}/task-proposals`,
    );
    setHistory(page.entries);
    setMore(page.has_more);
  }
  return (
    <div className="auto-schedule">
      <Link className="back-link" href={`/deadlines/${encodeURIComponent(id)}`}>
        ← 일정 상세
      </Link>
      <PageHeading
        eyebrow="할 일 계획"
        title="마감일까지 할 일 계획"
        description={`${initial.deadline.title} · 마감 ${formatLocal(initial.deadline.safe_due_at || initial.deadline.due_at)}`}
      />
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          if (!guard.confirmDiscard()) return;
          void action(async () => {
            request.current ??= crypto.randomUUID();
            const value = await api<Proposal>(
              `/api/deadlines/${encodeURIComponent(id)}/task-proposals`,
              {
                method: "POST",
                body: JSON.stringify({
                  request_id: request.current,
                  allow_external_ai: consent,
                  notes,
                }),
              },
            );
            show(value);
            notesGuard.markSaved();
            await refreshHistory();
            request.current = null;
          });
        }}
      >
        <fieldset disabled={busy}>
          <h2>필요한 할 일 제안받기</h2>
          <label>
            계획에 참고할 메모 (선택)
            <textarea
              maxLength={4000}
              rows={3}
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                request.current = null;
              }}
              placeholder="예: 자료 조사와 초안 작성, 검토 시간이 필요해요."
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            마감일의 제목·설명·기한과 입력한 메모를 AI(구글 Gemini)에 전송하여
            할 일을 제안받는 데 동의해요.
          </label>
          <p className="small muted">
            AI의 예상 소요시간과 권장 완료일을 확인해 주세요. 승인 전에는 할
            일이나 캘린더 일정이 등록되지 않아요.
          </p>
          <button disabled={!consent}>
            {busy ? "처리 중…" : "AI로 할 일 제안받기"}
          </button>
        </fieldset>
      </form>
      {error && <ErrorNotice message={error} />}
      {plan && (
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            if (plan.status !== "ready") return;
            void action(async () => {
              try {
                const saved = await api<Proposal>(path(plan.id), {
                  method: "PATCH",
                  body: JSON.stringify({
                    revision: plan.revision,
                    candidates: draft,
                  }),
                });
                show(saved);
                const approved = await api<Proposal>(
                  path(plan.id) + "/approve",
                  {
                    method: "POST",
                    body: JSON.stringify({ revision: saved.revision }),
                  },
                );
                show(approved);
                await refreshHistory();
              } catch (err) {
                const latest = await api<Proposal>(path(plan.id)).catch(
                  () => null,
                );
                if (latest?.status === "approved") {
                  show(latest);
                  await refreshHistory();
                  return;
                }
                throw err;
              }
            });
          }}
        >
          <h2>제안한 할 일 검토</h2>
          {plan.warnings.map((w, i) => (
            <p key={i} className="small muted">
              {w}
            </p>
          ))}
          {plan.status === "approved" ? (
            <>
              <p role="status">
                할 일 {plan.approved_task_ids.length}개와 할 일 순서를
                등록했어요. 자동 시간 추천에서 가능한 시간을 확인할 수 있어요.
              </p>
              <Link className="button" href="/planning">
                자동 시간 추천으로 이동
              </Link>
            </>
          ) : plan.status === "rejected" ? (
            <p>제외한 제안이에요.</p>
          ) : (
            <fieldset disabled={busy}>
              {draft.map((c, i) => (
                <section key={c.id} className="task-plan-candidate">
                  <h3>할 일 {i + 1}</h3>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={c.selected}
                      onChange={(e) =>
                        change(i, { selected: e.target.checked })
                      }
                    />
                    이 할 일 포함
                  </label>
                  <label>
                    할 일 제목
                    <input
                      required
                      maxLength={255}
                      value={c.title}
                      onChange={(e) => change(i, { title: e.target.value })}
                    />
                  </label>
                  <div className="form-grid">
                    <label>
                      소요시간 (분)
                      <input
                        type="number"
                        required
                        min={5}
                        max={1440}
                        value={c.estimated_minutes}
                        onChange={(e) =>
                          change(i, {
                            estimated_minutes: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      우선순위
                      <select
                        value={c.priority}
                        onChange={(e) =>
                          change(i, { priority: Number(e.target.value) })
                        }
                      >
                        {[1, 2, 3, 4, 5].map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label>
                    권장 완료일 (한국 시간)
                    <input
                      type="datetime-local"
                      required
                      value={toSeoulInput(c.latest_end)}
                      onChange={(e) => {
                        if (e.target.value)
                          change(i, {
                            latest_end: seoulInputToUtc(e.target.value),
                          });
                      }}
                    />
                  </label>
                  <label>
                    메모
                    <textarea
                      maxLength={2000}
                      rows={2}
                      value={c.description}
                      onChange={(e) =>
                        change(i, { description: e.target.value })
                      }
                    />
                  </label>
                  <details>
                    <summary>
                      먼저 끝내야 할 일 ({c.depends_on.length}개)
                    </summary>
                    {draft
                      .filter((p) => p.id !== c.id)
                      .map((p) => (
                        <label key={p.id} className="checkbox">
                          <input
                            type="checkbox"
                            checked={c.depends_on.includes(p.id)}
                            onChange={(e) =>
                              change(i, {
                                depends_on: e.target.checked
                                  ? [...c.depends_on, p.id]
                                  : c.depends_on.filter((id) => id !== p.id),
                              })
                            }
                          />
                          {p.title}
                        </label>
                      ))}
                  </details>
                </section>
              ))}
              <p className="small muted">
                먼저 해야 할 일도 함께 선택해 주세요. 서로를 먼저 하도록 연결할
                수는 없어요.
              </p>
              <div className="form-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    if (guard.confirmDiscard())
                      void action(async () => {
                        show(
                          await api<Proposal>(path(plan.id) + "/reject", {
                            method: "POST",
                            body: JSON.stringify({ revision: plan.revision }),
                          }),
                        );
                        await refreshHistory();
                      });
                  }}
                >
                  제안 제외
                </button>
                <button disabled={!draft.some((c) => c.selected)}>
                  {busy ? "등록 중…" : "선택한 할 일 등록"}
                </button>
              </div>
            </fieldset>
          )}
        </form>
      )}
      <section className="card">
        <h2>이전 제안 기록</h2>
        {!history.length && (
          <p className="muted">아직 제안받은 할 일이 없어요.</p>
        )}
        {history.map((p) => (
          <p key={p.id}>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                if (guard.confirmDiscard())
                  void action(async () =>
                    show(await api<Proposal>(path(p.id))),
                  );
              }}
            >
              {formatLocal(p.created_at)} ·{" "}
              {p.status === "approved"
                ? "등록 완료"
                : p.status === "ready"
                  ? "검토 대기"
                  : "제외"}
            </button>
          </p>
        ))}
        {more && (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                const page = await api<{
                  entries: Proposal[];
                  has_more: boolean;
                }>(
                  `/api/deadlines/${encodeURIComponent(id)}/task-proposals?offset=${history.length}`,
                );
                setHistory((items) => [...items, ...page.entries]);
                setMore(page.has_more);
              })
            }
          >
            이전 제안 더 보기
          </button>
        )}
      </section>
    </div>
  );
}
