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
import {
  HighlightTitle,
  TitleSearch,
  useTitleSearch,
} from "@/components/title-search";
export function SourceList() {
  const search = useTitleSearch();
  const { page, query } = search;
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
      <TitleSearch
        label="원본 자료 제목 검색"
        query={query}
        disabled={deletion.busy}
        onEdit={() => deletion.exit()}
        onApply={(value) => {
          if (!deletion.busy) {
            deletion.exit();
            search.apply(value);
          }
        }}
      />
      <div className="notice subtle">
        URL·텍스트·이미지를 저장하면 마감일 검토로 이어집니다. 기존 자료는 상세
        화면에서도 검토할 수 있습니다. PDF 업로드는 준비 중입니다.
      </div>
      <ListDeleteNotice
        deletion={deletion}
        consequence="마감일이 등록된 자료는 삭제할 수 없습니다. 삭제 가능한 자료의 분석 기록은 함께 삭제되며 Google 일정은 유지됩니다."
      />
      <SourcePage
        key={`${query}:${page}:${version}`}
        page={page}
        query={query}
        deletion={deletion}
        onChange={(next) => {
          if (deletion.busy) return;
          deletion.exit();
          search.setPage(next);
        }}
      />
    </>
  );
}
function SourcePage({
  page,
  query,
  onChange,
  deletion,
}: {
  page: number;
  query: string;
  onChange: (page: number) => void;
  deletion: ListDeletion;
}) {
  const loader = useCallback(
    (signal: AbortSignal) => sourcesApi.list(page * 50, query, signal),
    [page, query],
  );
  const { data, loading, error, reload } = useResource(loader);
  if (loading) return <Loading />;
  if (error) return <ErrorNotice message={error} retry={reload} />;
  return (
    <>
      {!data?.length ? (
        <Empty
          title={query ? "검색 결과가 없습니다" : "등록된 자료가 없습니다"}
        >
          {query
            ? "다른 제목으로 검색해 보세요."
            : "자료를 등록하면 이곳에서 다시 확인할 수 있어요."}
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
                <SourceCard source={source} query={query} selecting />
              </DeleteSelectable>
            ) : (
              <SourceCard key={source.id} source={source} query={query} />
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
  query = "",
  selecting = false,
}: {
  source: Source;
  query?: string;
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
      <h2>
        <HighlightTitle
          title={source.title || "제목 없는 자료"}
          query={query}
        />
      </h2>
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
