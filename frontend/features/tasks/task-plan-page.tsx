"use client";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { PageHeading } from "@/components/page-heading";
import { ErrorNotice, Loading } from "@/components/feedback";
import { api, errorMessage } from "@/lib/api/client";
import { useResource } from "@/lib/api/use-resource";
import { useUnsavedChanges } from "@/lib/unsaved-changes";
import { formatSeoul, seoulInputToUtc, toSeoulInput } from "@/lib/date/seoul";
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
        eyebrow="AI TASK PLANNING"
        title="마감일까지 작업 계획"
        description={`${initial.deadline.title} · 마감 ${formatSeoul(initial.deadline.safe_due_at || initial.deadline.due_at)}`}
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
          <h2>필요한 작업 제안받기</h2>
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
            마감일의 제목·설명·기한과 입력한 메모를 Google Gemini에 전송하여
            작업을 제안받는 데 동의합니다.
          </label>
          <p className="small muted">
            AI의 예상 소요시간과 권장 완료일을 확인해 주세요. 승인 전에는 할
            일이나 캘린더 일정이 등록되지 않습니다.
          </p>
          <button disabled={!consent}>
            {busy ? "처리 중…" : "AI 작업 후보 만들기"}
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
          <h2>작업 후보 검토</h2>
          {plan.warnings.map((w, i) => (
            <p key={i} className="small muted">
              {w}
            </p>
          ))}
          {plan.status === "approved" ? (
            <>
              <p role="status">
                할 일 {plan.approved_task_ids.length}개와 작업 순서를
                등록했습니다. 할 일 시간 추천에서 가능한 시간을 확인할 수
                있습니다.
              </p>
              <Link className="button" href="/planning">
                할 일 시간 추천으로 이동
              </Link>
            </>
          ) : plan.status === "rejected" ? (
            <p>제외한 후보입니다.</p>
          ) : (
            <fieldset disabled={busy}>
              {draft.map((c, i) => (
                <section key={c.id} className="task-plan-candidate">
                  <h3>작업 {i + 1}</h3>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={c.selected}
                      onChange={(e) =>
                        change(i, { selected: e.target.checked })
                      }
                    />
                    이 작업 포함
                  </label>
                  <label>
                    작업 제목
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
                      먼저 끝내야 할 작업 ({c.depends_on.length}개)
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
                먼저 해야 할 작업도 함께 선택해 주세요. 서로를 먼저 하도록
                연결할 수는 없습니다.
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
                  후보 제외
                </button>
                <button disabled={!draft.some((c) => c.selected)}>
                  {busy ? "등록 중…" : "선택한 작업 등록"}
                </button>
              </div>
            </fieldset>
          )}
        </form>
      )}
      <section className="card">
        <h2>저장한 작업 후보</h2>
        {!history.length && (
          <p className="muted">아직 제안받은 후보가 없습니다.</p>
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
              {formatSeoul(p.created_at)} ·{" "}
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
            이전 후보 더 보기
          </button>
        )}
      </section>
    </div>
  );
}
