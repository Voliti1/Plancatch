"use client";
import { useCallback, useState } from "react";
import { api } from "@/lib/api/client";
import { useResource } from "@/lib/api/use-resource";
import { ErrorNotice, Loading } from "@/components/feedback";
import { GoogleExportPanel } from "./export-panel";

type Entry = {
  kind: "task" | "deadline" | "event";
  item_id: string;
  title: string;
  status: string;
};
export function ManagedExports() {
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Entry | null>(null);
  const loader = useCallback(
    (signal: AbortSignal) =>
      api<{ entries: Entry[]; has_more: boolean }>(
        `/api/integrations/google-calendar/exports?limit=20&offset=${offset}`,
        { signal },
      ),
    [offset],
  );
  const data = useResource(loader);
  return (
    <>
      <section className="card form-card" aria-label="Google에 보낸 일정 관리">
        <h2>Google에 보낸 일정</h2>
        <p className="small muted">
          플랜캐치에서 보낸 일정만 관리합니다. 로컬 자료를 이미 지웠더라도 전송
          기록을 선택해 Google 삭제 상태를 확인할 수 있습니다.
        </p>
        {data.loading && <Loading />}
        {data.error && <ErrorNotice message={data.error} retry={data.reload} />}
        {data.data && (
          <>
            {data.data.entries.length === 0 && <p>보낸 일정이 없습니다.</p>}
            <div className="managed-google-exports">
              {data.data.entries.map((entry) => (
                <button
                  type="button"
                  className="secondary"
                  key={`${entry.kind}:${entry.item_id}`}
                  aria-pressed={
                    selected?.kind === entry.kind &&
                    selected?.item_id === entry.item_id
                  }
                  onClick={() => setSelected(entry)}
                >
                  {entry.title} ·{" "}
                  {entry.status === "deleted"
                    ? "삭제 완료"
                    : entry.status === "changing"
                      ? "자동 반영 중"
                      : entry.status === "pending"
                        ? "반영 대기 중"
                        : entry.status === "conflict"
                          ? "확인 필요"
                          : "전송 완료"}
                </button>
              ))}
            </div>
            <div className="actions">
              <button
                type="button"
                className="secondary"
                disabled={offset === 0 || data.loading}
                onClick={() => {
                  setOffset(Math.max(0, offset - 20));
                  setSelected(null);
                }}
              >
                이전 목록
              </button>
              <button
                type="button"
                className="secondary"
                disabled={!data.data.has_more || data.loading}
                onClick={() => {
                  setOffset(offset + 20);
                  setSelected(null);
                }}
              >
                다음 목록
              </button>
              <button type="button" className="secondary" onClick={data.reload}>
                목록 새로고침
              </button>
            </div>
          </>
        )}
      </section>
      {selected && (
        <GoogleExportPanel
          key={`${selected.kind}:${selected.item_id}`}
          kind={selected.kind}
          itemId={selected.item_id}
          onChanged={data.reload}
        />
      )}
    </>
  );
}
