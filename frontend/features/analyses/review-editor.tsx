"use client";
import { useScheduleTime } from "@/features/settings/time-zone";
import {
  DISCARD_NAVIGATION_EVENT,
  useUnsavedChanges,
} from "@/lib/unsaved-changes";
import { useEffect, useId, useRef, useState } from "react";
import { ApiError } from "@/lib/api/client";
import { ErrorNotice } from "@/components/feedback";
import { localInput, zonedInputToUtc } from "@/lib/date/time-zones";
import type {
  Analysis,
  AnalysisCandidate,
  CandidateEdit,
} from "@/types/analysis";
import { analysesApi } from "./api";
import { analysisError } from "./errors";
import { RemainingPeriod } from "./remaining-period";
import { isExtractedPdf, isHtmlAnalysis } from "./display";
import { briefEvidence } from "./brief-evidence";
import {
  ReminderSettings,
  validateReminders,
} from "@/features/google-calendar/reminder-settings";
import { newReminderSettings } from "@/types/google-reminders";

type Draft = {
  id: string;
  title: string;
  due: string;
  description: string;
  selected: boolean;
  chosenDue?: string;
  suggestionTouched?: boolean;
};
const draftOf = (candidate: AnalysisCandidate, zone: string): Draft => ({
  id: candidate.id,
  title: candidate.title,
  due: candidate.due_at ? localInput(candidate.due_at, zone) : "",
  description: candidate.description ?? "",
  selected: candidate.selected,
});
function suggestedDraftOf(candidate: AnalysisCandidate, zone: string): Draft {
  const draft = draftOf(candidate, zone);
  if (candidate.suggested_due_at) {
    draft.due = localInput(candidate.suggested_due_at, zone);
    draft.chosenDue = candidate.suggested_due_at;
  }
  return draft;
}
function payloadOf(
  draft: Draft,
  original: AnalysisCandidate,
  zone: string,
): CandidateEdit {
  if (!draft.title.trim())
    throw new Error(
      "제외한 항목도 제목을 입력한 뒤 검토 내용을 저장해 주세요.",
    );
  return {
    id: draft.id,
    title: draft.title.trim(),
    due_at: !draft.due
      ? null
      : draft.chosenDue && draft.due === localInput(draft.chosenDue, zone)
        ? draft.chosenDue
        : original.due_at && draft.due === localInput(original.due_at, zone)
          ? original.due_at
          : zonedInputToUtc(draft.due, zone),
    description: draft.description.trim() || null,
    selected: draft.selected,
  };
}
export function CandidateEvidence({
  candidate,
  model,
}: {
  candidate: AnalysisCandidate;
  model: string;
}) {
  return (
    <div className="candidate-evidence">
      <h4>날짜를 찾은 부분</h4>
      {model.startsWith("pdf:") && (
        <p className="small muted">
          {candidate.evidence_page
            ? `PDF ${candidate.evidence_page}페이지`
            : "PDF 근거 페이지를 확인할 수 없어요."}
        </p>
      )}
      <p className="analysis-text">{briefEvidence(candidate.evidence_text)}</p>
      <p className="small muted">
        {isHtmlAnalysis(model)
          ? "페이지에 적힌 접수 기간을 그대로 읽어 왔어요."
          : isExtractedPdf(model)
            ? "PDF에서 읽은 근거예요."
            : `AI 확신 정도 ${Math.round(candidate.confidence * 100)}% · 등록 전 날짜를 꼭 확인해 주세요.`}
      </p>
    </div>
  );
}
export function ReviewEditor({
  analysis: initialAnalysis,
  now,
  onUpdated,
}: {
  analysis: Analysis;
  now: number | null;
  onUpdated: (data: Analysis, message: string) => void;
}) {
  const { toLocalInput, fromLocalInput, zoneLabel, zone } = useScheduleTime();
  const [analysis, setAnalysis] = useState(initialAnalysis);
  const [drafts, setDrafts] = useState(() =>
    analysis.candidates.map((candidate) => suggestedDraftOf(candidate, zone)),
  );
  const [reminders, setReminders] = useState(newReminderSettings);
  const { markSaved } = useUnsavedChanges(JSON.stringify([drafts, reminders]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const [choiceNotice, setChoiceNotice] = useState("");
  const pending = useRef(false);
  const active = useRef(true);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current = true;
    const stopFollowingApproval = () => request.current?.abort();
    window.addEventListener(DISCARD_NAVIGATION_EVENT, stopFollowingApproval);
    return () => {
      window.removeEventListener(
        DISCARD_NAVIGATION_EVENT,
        stopFollowingApproval,
      );
      active.current = false;
      request.current?.abort();
    };
  }, []);
  const formId = useId();
  const dirty =
    JSON.stringify(drafts) !==
    JSON.stringify(
      analysis.candidates.map((candidate) => draftOf(candidate, zone)),
    );
  const selected = drafts.filter((item) => item.selected);
  const canApprove =
    selected.length > 0 &&
    selected.every((item) => item.due && item.title.trim());
  function update(index: number, fields: Partial<Draft>) {
    setDrafts((items) =>
      items.map((item, position) =>
        position === index ? { ...item, ...fields } : item,
      ),
    );
  }
  async function mutate(action: "save" | "approve" | "reject" | "reload") {
    if (pending.current) return;
    if (action === "approve" && !canApprove) return;
    pending.current = true;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    setConflict(false);
    try {
      if (action === "approve") validateReminders(reminders);
      let current = analysis;
      if (action === "approve" && dirty) {
        current = await analysesApi.review(
          analysis.id,
          analysis.revision,
          drafts.map((draft, index) =>
            payloadOf(draft, analysis.candidates[index], zone),
          ),
          controller.signal,
        );
        if (!active.current || controller.signal.aborted) return;
        // Keep the acknowledged revision locally so a failed approval can retry
        // without re-saving an older revision or losing the user's edits.
        setAnalysis(current);
        const savedDrafts = current.candidates.map((candidate) =>
          suggestedDraftOf(candidate, zone),
        );
        setDrafts(savedDrafts);
        markSaved(JSON.stringify([savedDrafts, newReminderSettings()]));
      }
      if (!active.current || controller.signal.aborted) return;
      const result =
        action === "save"
          ? await analysesApi.review(
              analysis.id,
              analysis.revision,
              drafts.map((draft, index) =>
                payloadOf(draft, analysis.candidates[index], zone),
              ),
              controller.signal,
            )
          : action === "approve"
            ? await analysesApi.approve(
                current.id,
                current.revision,
                reminders,
                controller.signal,
              )
            : action === "reject"
              ? await analysesApi.reject(analysis.id, analysis.revision)
              : await analysesApi.get(analysis.id);
      if (!active.current || controller.signal.aborted) return;
      const savedDrafts = result.candidates.map((candidate) =>
        suggestedDraftOf(candidate, zone),
      );
      const defaultReminders = newReminderSettings();
      setAnalysis(result);
      setDrafts(savedDrafts);
      if (action === "reload") setReminders(defaultReminders);
      markSaved(
        JSON.stringify([
          savedDrafts,
          action === "approve" ? reminders : defaultReminders,
        ]),
      );
      setConfirmReject(false);
      setConfirmReload(false);
      setChoiceNotice("");
      onUpdated(
        result,
        action === "save"
          ? "검토 내용을 저장했어요."
          : action === "reload"
            ? "최신 결과를 불러왔어요."
            : "",
      );
    } catch (err) {
      if (!active.current || controller.signal.aborted) return;
      setError(analysisError(err));
      setConflict(err instanceof ApiError && err.status === 409);
    } finally {
      pending.current = false;
      request.current = null;
      if (active.current) setBusy(false);
    }
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void mutate("save");
      }}
    >
      <fieldset disabled={busy}>
        {drafts.map((draft, index) => {
          const original = analysis.candidates[index];
          const originalDate =
            analysis.source_period &&
            (analysis.source_period.site === "jobplanet" ||
              analysis.source_period.site === "linkareer" ||
              analysis.source_period.site === "work24") &&
            !analysis.source_period.has_conflict
              ? analysis.date_choices?.find(
                  (choice) => choice.date && !choice.due_at,
                )?.date
              : undefined;
          const dateChanged =
            draft.due !==
            (original.due_at ? toLocalInput(original.due_at) : "");
          let countdownDate = original.due_at;
          if (dateChanged) {
            try {
              countdownDate = draft.due ? fromLocalInput(draft.due) : null;
            } catch {
              countdownDate = null;
            }
          }
          return (
            <article className="analysis-candidate" key={draft.id}>
              <h3>찾은 마감일 {index + 1}</h3>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={draft.selected}
                  onChange={(event) =>
                    update(index, { selected: event.target.checked })
                  }
                />
                등록할 일정에 포함 {index + 1}
              </label>
              <label htmlFor={`${formId}-${index}-title`}>
                찾은 마감일 {index + 1} 제목
              </label>
              <input
                id={`${formId}-${index}-title`}
                value={draft.title}
                required
                maxLength={255}
                onChange={(event) =>
                  update(index, { title: event.target.value })
                }
              />
              <label htmlFor={`${formId}-${index}-due`}>
                찾은 마감일 {index + 1} 마감일 ({zoneLabel})
              </label>
              <input
                id={`${formId}-${index}-due`}
                type="datetime-local"
                value={draft.due}
                onChange={(event) =>
                  update(index, {
                    due: event.target.value,
                    chosenDue: undefined,
                    suggestionTouched: original.suggested_due_at
                      ? true
                      : undefined,
                  })
                }
              />
              {(analysis.date_choices?.length ?? 0) > 0 && (
                <div
                  role="group"
                  aria-label={`찾은 마감일 ${index + 1} 읽은 날짜 선택`}
                >
                  <p className="small muted">
                    {analysis.model.startsWith("image:")
                      ? "사진에서 읽은 마감일을 확인하세요. 시간이 없으면 오후 11시 59분으로 설정돼요."
                      : "페이지에서 찾은 날짜 중 마감일을 선택하세요."}
                  </p>
                  <div className="review-secondary-actions">
                    {analysis.date_choices!.map((choice) => (
                      <button
                        key={choice.id}
                        type="button"
                        className="secondary"
                        aria-pressed={Boolean(
                          choice.due_at &&
                          draft.due === toLocalInput(choice.due_at),
                        )}
                        onClick={() => {
                          update(index, {
                            due:
                              choice.due_at && !analysis.is_open_ended
                                ? toLocalInput(choice.due_at)
                                : "",
                            selected: true,
                            chosenDue: !analysis.is_open_ended
                              ? (choice.due_at ?? undefined)
                              : undefined,
                          });
                          setChoiceNotice(
                            choice.due_at && !analysis.is_open_ended
                              ? `선택한 날짜: ${choice.raw_text}. ‘일정 등록’을 누르면 수정 내용도 함께 저장돼요.`
                              : `선택한 자료 내용: ${choice.raw_text}. 빠진 연도나 시간을 추측하지 않아요. 마감 일시를 직접 입력해 주세요.`,
                          );
                        }}
                      >
                        {choice.raw_text}
                        {!choice.due_at ? " · 일시 입력 필요" : ""}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {analysis.is_open_ended && (
                <p className="notice small">
                  채용 시 마감·상시 모집이에요. 원하는 마감 날짜와 시간을 직접
                  입력해야 등록할 수 있어요.
                </p>
              )}
              {original.time_defaulted && draft.due && (
                <p className="notice small">
                  마감 시간이 없어 오후 11시 59분으로 설정했어요. 필요하면
                  변경해 주세요.
                </p>
              )}
              {original.suggested_due_at && draft.due && (
                <p className="notice small">
                  자료 내용에서 확인한 마감일을 입력했어요. 내용을 확인한 뒤
                  일정 등록을 눌러 주세요.
                </p>
              )}
              {!original.due_at && !original.suggested_due_at && !draft.due && (
                <p className="notice small">
                  {originalDate
                    ? `자료 내용 마감 날짜는 ${originalDate}이에요. 마감 시각을 직접 입력하고 찾은 마감일을 포함해 주세요.`
                    : "자료 내용에서 날짜를 확정하지 못했어요. 마감일을 직접 확인하거나 찾은 마감일을 제외해 주세요."}
                </p>
              )}
              <RemainingPeriod
                dueAt={countdownDate}
                now={now}
                editing={dateChanged}
              />
              <label htmlFor={`${formId}-${index}-description`}>
                찾은 마감일 {index + 1} 설명 (선택)
              </label>
              <textarea
                id={`${formId}-${index}-description`}
                rows={3}
                maxLength={2000}
                value={draft.description}
                onChange={(event) =>
                  update(index, { description: event.target.value })
                }
              />
              <CandidateEvidence candidate={original} model={analysis.model} />
            </article>
          );
        })}
        {drafts.length === 0 && (
          <p className="notice">
            찾은 마감일이 없어요. 자료 내용과 주의사항을 확인해 주세요.
          </p>
        )}
        {drafts.length > 0 && (
          <div>
            <ReminderSettings
              value={reminders}
              onChange={(value) => setReminders(value ?? newReminderSettings())}
            />
            <p className="small muted">
              선택한 마감일에 같은 알림을 적용해요. 일정 등록을 누를 때
              저장돼요.
            </p>
          </div>
        )}
        <div className="review-actions">
          {choiceNotice && (
            <p className="notice small" role="status">
              {choiceNotice}
            </p>
          )}
          <p>
            {selected.length}개 선택 · 승인 전에는 실제 마감일이 생성되지
            않아요.
          </p>
          {dirty && (
            <p className="notice small">
              일정 등록을 누르면 수정한 내용을 함께 저장해요.
            </p>
          )}
          {selected.some((item) => !item.due) && (
            <p className="notice small">
              등록할 항목의 날짜와 시간을 입력하거나 선택을 해제해 주세요.
            </p>
          )}
          <div className="form-actions">
            <button
              className="secondary"
              type="submit"
              disabled={!dirty || confirmReject || confirmReload}
            >
              {busy ? "처리 중…" : "검토 내용 저장"}
            </button>
            <button
              type="button"
              disabled={!canApprove || confirmReject || confirmReload}
              onClick={() => void mutate("approve")}
            >
              {busy ? "처리 중…" : `선택한 ${selected.length}개 일정 등록`}
            </button>
          </div>
          <p className="muted small">
            선택한 마감일을 등록해요. 캘린더에 바로 표시되며, 구글 계정을
            연결했다면 자동으로 반영돼요.
          </p>
          <div className="review-secondary-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setConfirmReject(true);
                setConfirmReload(false);
              }}
            >
              전체 거부
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                if (dirty || reminders.mode !== "none") {
                  setConfirmReload(true);
                  setConfirmReject(false);
                } else void mutate("reload");
              }}
            >
              최신 결과 불러오기
            </button>
          </div>
          {confirmReject && (
            <div
              className="notice"
              role="group"
              aria-label="분석 전체 거부 확인"
            >
              <p>
                선택 여부와 관계없이 이번 분석 결과 전체를 거부해요. 마감일은
                생성되지 않아요.
              </p>
              <div className="form-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setConfirmReject(false)}
                >
                  거부 취소
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => void mutate("reject")}
                >
                  전체 거부 확인
                </button>
              </div>
            </div>
          )}
          {confirmReload && (
            <div className="notice" role="group" aria-label="최신 결과 확인">
              <p>수정한 내용을 지우고 마지막으로 저장한 결과를 불러올까요?</p>
              <div className="form-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setConfirmReload(false)}
                >
                  계속 수정
                </button>
                <button type="button" onClick={() => void mutate("reload")}>
                  입력을 버리고 불러오기
                </button>
              </div>
            </div>
          )}
        </div>
      </fieldset>
      {error && <ErrorNotice message={error} />}
      {conflict && (
        <p className="small muted">
          수정 입력을 유지했어요. 최신 결과를 확인하거나 자료에서 다시
          추출·분석해 주세요.
        </p>
      )}
    </form>
  );
}
