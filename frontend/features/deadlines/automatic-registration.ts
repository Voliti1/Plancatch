import { analysesApi } from "@/features/analyses/api";
import { processingError } from "@/features/analyses/errors";
import { sourcesApi } from "@/features/sources/api";
import { ApiError } from "@/lib/api/client";

export interface RegistrationDraft {
  title: string;
  url: string;
  sourceId?: string;
  analysisId?: string;
}

function pause(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const cancel = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, 2000);
    signal.addEventListener("abort", cancel, { once: true });
  });
}

async function waitFor<T>(
  read: (signal: AbortSignal) => Promise<T>,
  processing: (item: T) => boolean,
  signal: AbortSignal,
) {
  const expires = Date.now() + 90000;
  while (Date.now() < expires) {
    signal.throwIfAborted();
    const item = await read(
      AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    );
    if (!processing(item)) return item;
    await pause(signal);
  }
  throw new Error(
    "90초 동안 완료되지 않아 대기를 중단했습니다. ‘이어서 등록’으로 상태를 다시 확인해 주세요. 서버 작업은 취소되지 않습니다.",
  );
}

export async function registerAutomatically(
  initial: RegistrationDraft,
  signal: AbortSignal,
  save: (draft: RegistrationDraft) => void,
  progress: (message: string) => void,
): Promise<{ kind: "registered" | "review"; id: string }> {
  let draft = { ...initial };
  const requestSignal = () =>
    AbortSignal.any([signal, AbortSignal.timeout(15000)]);
  if (!draft.sourceId) {
    progress("1/3 · URL 자료를 저장하고 있습니다.");
    const source = await sourcesApi.create(
      { source_type: "url", title: draft.title, original_url: draft.url },
      requestSignal(),
    );
    draft = {
      ...draft,
      sourceId: source.id,
      url: source.original_url ?? draft.url,
    };
    save(draft);
  }
  const sourceId = draft.sourceId!;
  let source = await sourcesApi.get(sourceId, requestSignal());
  if (source.title !== draft.title || source.original_url !== draft.url)
    throw new Error(
      "저장한 자료가 변경되었습니다. 원본 자료 상세에서 내용을 확인해 주세요.",
    );
  progress("2/3 · URL에서 원문 텍스트를 추출하고 있습니다.");
  if (
    source.processing_status !== "extracted" &&
    source.processing_status !== "processing"
  )
    source = await sourcesApi.extract(sourceId, requestSignal());
  if (source.processing_status === "processing")
    source = await waitFor(
      (nextSignal) => sourcesApi.get(sourceId, nextSignal),
      (item) => item.processing_status === "processing",
      signal,
    );
  if (source.processing_status !== "extracted" || !source.extracted_text)
    throw new Error(processingError(source.error_message ?? "empty_content"));
  if (Array.from(source.extracted_text).length > 40000)
    throw new Error(
      "추출 원문이 AI 분석 한도 40,000자를 초과했습니다. 원본 자료에서 필요한 부분을 텍스트로 나누어 등록해 주세요.",
    );
  progress("3/3 · AI가 마감일을 분석하고 있습니다.");
  // Recover an interrupted/lost POST response using this form's already-created source.
  let analysis = draft.analysisId
    ? await analysesApi.get(draft.analysisId, requestSignal())
    : (await analysesApi.list(sourceId, 0, requestSignal()))[0];
  if (!analysis || analysis.status === "failed")
    analysis = await analysesApi.start(sourceId, requestSignal());
  draft = { ...draft, analysisId: analysis.id };
  save(draft);
  if (analysis.status === "processing")
    analysis = await waitFor(
      (nextSignal) => analysesApi.get(analysis.id, nextSignal),
      (item) => item.status === "processing",
      signal,
    );
  if (analysis.status === "failed")
    throw new Error(
      processingError(analysis.error_message ?? "ai_processing_failed"),
    );
  if (analysis.status !== "approved") {
    if (analysis.status !== "ready") return { kind: "review", id: analysis.id };
    progress("추출한 마감일을 입력한 제목으로 등록하고 있습니다.");
    try {
      analysis = await analysesApi.autoRegister(
        analysis.id,
        analysis.revision,
        draft.title,
        requestSignal(),
      );
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 422 &&
        err.message === "auto_registration_requires_review"
      )
        return { kind: "review", id: analysis.id };
      throw err;
    }
  }
  if (analysis.approved_deadline_ids.length !== 1)
    return { kind: "review", id: analysis.id };
  return { kind: "registered", id: analysis.approved_deadline_ids[0] };
}
