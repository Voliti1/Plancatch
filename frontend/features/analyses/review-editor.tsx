"use client";
import { useId, useRef, useState } from "react";
import { ApiError } from "@/lib/api/client";
import { ErrorNotice } from "@/components/feedback";
import { seoulInputToUtc, toSeoulInput } from "@/lib/date/seoul";
import type {
  Analysis,
  AnalysisCandidate,
  CandidateEdit,
} from "@/types/analysis";
import { analysesApi } from "./api";
import { analysisError } from "./errors";
import { RemainingPeriod } from "./remaining-period";
import { isHtmlAnalysis } from "./display";
import { briefEvidence } from "./brief-evidence";

type Draft = {
  id: string;
  title: string;
  due: string;
  description: string;
  selected: boolean;
  chosenDue?: string;
};
const draftOf = (candidate: AnalysisCandidate): Draft => ({
  id: candidate.id,
  title: candidate.title,
  due: candidate.due_at ? toSeoulInput(candidate.due_at) : "",
  description: candidate.description ?? "",
  selected: candidate.selected,
});
function payloadOf(draft: Draft, original: AnalysisCandidate): CandidateEdit {
  if (!draft.title.trim())
    throw new Error("제외한 후보를 포함해 모든 후보의 제목을 입력해 주세요.");
  return {
    id: draft.id,
    title: draft.title.trim(),
    due_at: !draft.due
      ? null
      : draft.chosenDue && draft.due === toSeoulInput(draft.chosenDue)
        ? draft.chosenDue
        : original.due_at && draft.due === toSeoulInput(original.due_at)
          ? original.due_at
          : seoulInputToUtc(draft.due),
    description: draft.description.trim() || null,
    selected: draft.selected,
  };
}
export function CandidateEvidence({
  candidate,
  fromHtml = false,
}: {
  candidate: AnalysisCandidate;
  fromHtml?: boolean;
}) {
  return (
    <div className="candidate-evidence">
      <h4>원문 근거</h4>
      <p className="analysis-text">{briefEvidence(candidate.evidence_text)}</p>
      <p className="small muted">
        {fromHtml
          ? "HTML에 명시된 접수기간을 직접 확인한 결과입니다. AI 추정값이 아닙니다."
          : `AI 신뢰도 참고값 ${Math.round(candidate.confidence * 100)}% · 정확도를 보장하지 않습니다.`}
      </p>
    </div>
  );
}
export function ReviewEditor({
  analysis,
  now,
  onUpdated,
}: {
  analysis: Analysis;
  now: number | null;
  onUpdated: (data: Analysis, message: string) => void;
}) {
  const [drafts, setDrafts] = useState(() => analysis.candidates.map(draftOf));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const [choiceNotice, setChoiceNotice] = useState("");
  const pending = useRef(false);
  const formId = useId();
  const dirty =
    JSON.stringify(drafts) !== JSON.stringify(analysis.candidates.map(draftOf));
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
    if (action === "approve" && (dirty || !canApprove)) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setConflict(false);
    try {
      const result =
        action === "save"
          ? await analysesApi.review(
              analysis.id,
              analysis.revision,
              drafts.map((draft, index) =>
                payloadOf(draft, analysis.candidates[index]),
              ),
            )
          : action === "approve"
            ? await analysesApi.approve(analysis.id, analysis.revision)
            : action === "reject"
              ? await analysesApi.reject(analysis.id, analysis.revision)
              : await analysesApi.get(analysis.id);
      setDrafts(result.candidates.map(draftOf));
      setConfirmReject(false);
      setConfirmReload(false);
      onUpdated(
        result,
        action === "save"
          ? "검토 내용을 저장했습니다."
          : action === "reload"
            ? "최신 결과를 불러왔습니다."
            : "",
      );
    } catch (err) {
      setError(analysisError(err));
      setConflict(err instanceof ApiError && err.status === 409);
    } finally {
      pending.current = false;
      setBusy(false);
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
              analysis.source_period.site === "linkareer") &&
            !analysis.source_period.has_conflict
              ? analysis.date_choices?.find(
                  (choice) => choice.date && !choice.due_at,
                )?.date
              : undefined;
          const dateChanged =
            draft.due !==
            (original.due_at ? toSeoulInput(original.due_at) : "");
          let countdownDate = original.due_at;
          if (dateChanged) {
            try {
              countdownDate = draft.due ? seoulInputToUtc(draft.due) : null;
            } catch {
              countdownDate = null;
            }
          }
          return (
            <article className="analysis-candidate" key={draft.id}>
              <h3>후보 {index + 1}</h3>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={draft.selected}
                  onChange={(event) =>
                    update(index, { selected: event.target.checked })
                  }
                />
                후보 {index + 1} 포함
              </label>
              <label htmlFor={`${formId}-${index}-title`}>
                후보 {index + 1} 제목
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
                후보 {index + 1} 마감일 (한국 시간)
              </label>
              <input
                id={`${formId}-${index}-due`}
                type="datetime-local"
                value={draft.due}
                onChange={(event) =>
                  update(index, {
                    due: event.target.value,
                    chosenDue: undefined,
                  })
                }
              />
              {(analysis.date_choices?.length ?? 0) > 0 && (
                <div
                  role="group"
                  aria-label={`후보 ${index + 1} 읽은 날짜 선택`}
                >
                  <p className="small muted">
                    HTML에서 읽은 날짜 중 마감일을 선택하세요.
                  </p>
                  <div className="review-secondary-actions">
                    {analysis.date_choices!.map((choice) => (
                      <button
                        key={choice.id}
                        type="button"
                        className="secondary"
                        aria-pressed={Boolean(
                          choice.due_at &&
                          draft.due === toSeoulInput(choice.due_at),
                        )}
                        onClick={() => {
                          update(index, {
                            due:
                              choice.due_at && !analysis.is_open_ended
                                ? toSeoulInput(choice.due_at)
                                : "",
                            selected: true,
                            chosenDue: !analysis.is_open_ended
                              ? (choice.due_at ?? undefined)
                              : undefined,
                          });
                          setChoiceNotice(
                            choice.due_at && !analysis.is_open_ended
                              ? `선택한 날짜: ${choice.raw_text}. 검토 내용을 저장한 후 승인하세요.`
                              : `선택한 원문: ${choice.raw_text}. 빠진 연도나 시간을 추측하지 않습니다. 마감 일시를 직접 입력해 주세요.`,
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
                  채용 시 마감·상시 모집입니다. 원하는 마감 날짜와 시간을 직접
                  입력해야 등록할 수 있습니다.
                </p>
              )}
              {!original.due_at && (
                <p className="notice small">
                  {originalDate
                    ? `원문 마감 날짜는 ${originalDate}입니다. 마감 시각을 직접 입력하고 후보를 포함해 주세요.`
                    : "원문에서 날짜를 확정하지 못했습니다. 마감일을 직접 확인하거나 후보를 제외해 주세요."}
                </p>
              )}
              <RemainingPeriod
                dueAt={countdownDate}
                now={now}
                editing={dateChanged}
              />
              <label htmlFor={`${formId}-${index}-description`}>
                후보 {index + 1} 설명 (선택)
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
              <CandidateEvidence
                candidate={original}
                fromHtml={isHtmlAnalysis(analysis.model)}
              />
            </article>
          );
        })}
        {drafts.length === 0 && (
          <p className="notice">
            마감일 후보가 없습니다. 원문과 주의사항을 확인해 주세요.
          </p>
        )}
        <div className="review-actions">
          {choiceNotice && (
            <p className="notice small" role="status">
              {choiceNotice}
            </p>
          )}
          <p>
            {selected.length}개 선택 · 승인 전에는 실제 마감일이 생성되지
            않습니다.
          </p>
          {dirty && (
            <p className="notice small">
              수정한 내용을 먼저 저장해야 승인할 수 있습니다.
            </p>
          )}
          {selected.some((item) => !item.due) && (
            <p className="notice small">
              선택한 후보의 마감일을 입력하거나 선택을 해제해 주세요.
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
              disabled={dirty || !canApprove || confirmReject || confirmReload}
              onClick={() => void mutate("approve")}
            >
              선택한 {selected.length}개 승인
            </button>
          </div>
          <p className="muted small">
            승인은 마감일만 등록합니다. 작업·캘린더 일정은 자동으로 생성되지
            않습니다.
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
                if (dirty) {
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
                선택 여부와 관계없이 이번 분석 결과 전체를 거부합니다. 마감일은
                생성되지 않습니다.
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
              <p>
                현재 입력을 버리고 서버에 저장된 최신 결과를 불러오시겠습니까?
              </p>
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
          수정 입력을 유지했습니다. 최신 결과를 확인하거나 원본 자료에서 다시
          추출·분석해 주세요.
        </p>
      )}
    </form>
  );
}
