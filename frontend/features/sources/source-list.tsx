"use client";
import Link from "next/link";
import { useCallback, useState } from "react";
import { sourcesApi } from "./api";
import { useResource } from "@/lib/api/use-resource";
import { formatSeoul } from "@/lib/date/seoul";
import { Empty, ErrorNotice, Loading } from "@/components/feedback";
import { PageHeading } from "@/components/page-heading";
import { Pagination } from "@/components/pagination";
import { sourceTypeLabel, processingStatusLabel } from "./display";
import {
  DeleteSelectable,
  ListDeleteActions,
  ListDeleteNotice,
  useListDeletion,
  type ListDeletion,
} from "@/components/list-deletion";
import type { Source } from "@/types/api";
export function SourceList() {
  const [page, setPage] = useState(0);
  const [version, setVersion] = useState(0);
  const deletion = useListDeletion(sourcesApi.remove, () =>
    setVersion((value) => value + 1),
  );
  return (
    <>
      <PageHeading
        eyebrow="SOURCE LIBRARY"
        title="원본 자료"
        description="흩어져 있던 링크와 메모를 한곳에 모아 보세요."
        action={
          <ListDeleteActions deletion={deletion}>
            <Link
              className="button"
              href="/sources/new"
              aria-disabled={deletion.busy || undefined}
              onClick={(event) => {
                if (deletion.busy) event.preventDefault();
              }}
            >
              ＋ 자료 등록
            </Link>
          </ListDeleteActions>
        }
      />
      <div className="notice subtle">
        URL과 텍스트를 저장하면 바로 원문 추출과 마감일 검토로 이어집니다. 기존
        자료는 상세 화면에서도 검토할 수 있습니다. 파일 업로드는 준비 중입니다.
      </div>
      <ListDeleteNotice
        deletion={deletion}
        consequence="연결된 분석 기록도 삭제되며, 이미 등록된 마감일과 Google 일정은 유지됩니다."
      />
      <SourcePage
        key={`${page}:${version}`}
        page={page}
        deletion={deletion}
        onChange={(next) => {
          if (deletion.busy) return;
          deletion.exit();
          setPage(next);
        }}
      />
    </>
  );
}
function SourcePage({
  page,
  onChange,
  deletion,
}: {
  page: number;
  onChange: (page: number) => void;
  deletion: ListDeletion;
}) {
  const loader = useCallback(() => sourcesApi.list(page * 50), [page]);
  const { data, loading, error, reload } = useResource(loader);
  if (loading) return <Loading />;
  if (error) return <ErrorNotice message={error} retry={reload} />;
  return (
    <>
      {!data?.length ? (
        <Empty title="등록된 자료가 없습니다">
          자료를 등록하면 이곳에서 다시 확인할 수 있어요.
        </Empty>
      ) : (
        <div className="source-grid">
          {data.map((source) =>
            deletion.mode ? (
              <DeleteSelectable
                key={source.id}
                deletion={deletion}
                id={source.id}
                label={source.title || "제목 없는 자료"}
                className="card source-selectable"
              >
                <SourceCard source={source} selecting />
              </DeleteSelectable>
            ) : (
              <SourceCard key={source.id} source={source} />
            ),
          )}
        </div>
      )}
      <Pagination
        page={page}
        count={data?.length ?? 0}
        onChange={onChange}
        disabled={deletion.busy}
      />
    </>
  );
}
function SourceCard({
  source,
  selecting = false,
}: {
  source: Source;
  selecting?: boolean;
}) {
  return (
    <article className={selecting ? "source-card" : "card source-card"}>
      <div className="card-top">
        <span className="tag">{sourceTypeLabel(source.source_type)}</span>
        <span className="muted small">
          {processingStatusLabel(source.processing_status)}
        </span>
      </div>
      <h2>{source.title || "제목 없는 자료"}</h2>
      {source.original_url &&
        /^https?:\/\//i.test(source.original_url) &&
        (selecting ? (
          <span className="source-link">{source.original_url}</span>
        ) : (
          <a
            className="source-link"
            href={source.original_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {source.original_url} ↗
          </a>
        ))}
      {source.original_text &&
        (selecting ? (
          <p className="source-text">{source.original_text}</p>
        ) : (
          <details>
            <summary>텍스트 내용 보기</summary>
            <p className="source-text">{source.original_text}</p>
          </details>
        ))}
      {source.error_message && (
        <p className="error-text">{source.error_message}</p>
      )}
      <div className="source-card-footer">
        <p className="small muted">{formatSeoul(source.created_at)}</p>
        {!selecting && (
          <Link
            className="source-detail-link"
            href={`/sources/${encodeURIComponent(source.id)}`}
            aria-label={`${source.title || "제목 없는 자료"} 상세 보기`}
          >
            상세 보기 →
          </Link>
        )}
      </div>
    </article>
  );
}
