"use client";
import Link from "next/link";
import { useCallback, useState } from "react";
import { sourcesApi } from "./api";
import { useResource } from "@/lib/api/use-resource";
import { formatSeoul } from "@/lib/date/seoul";
import { Empty, ErrorNotice, Loading } from "@/components/feedback";
import { PageHeading } from "@/components/page-heading";
import { Pagination } from "@/components/pagination";
export function SourceList() {
  const [page, setPage] = useState(0);
  return (
    <>
      <PageHeading
        eyebrow="SOURCE LIBRARY"
        title="원본 자료"
        description="흩어져 있던 링크와 메모를 한곳에 모아 보세요."
        action={
          <Link className="button" href="/sources/new">
            ＋ 자료 등록
          </Link>
        }
      />
      <div className="notice subtle">
        URL과 텍스트를 저장할 수 있습니다. 파일 업로드와 AI 분석은 준비
        중입니다.
      </div>
      <SourcePage key={page} page={page} onChange={setPage} />
    </>
  );
}
function SourcePage({
  page,
  onChange,
}: {
  page: number;
  onChange: (page: number) => void;
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
          {data.map((source) => (
            <article className="card source-card" key={source.id}>
              <div className="card-top">
                <span className="tag">
                  {source.source_type === "url" ? "URL 링크" : "텍스트"}
                </span>
                <span className="muted small">등록됨</span>
              </div>
              <h2>{source.title || "제목 없는 자료"}</h2>
              {source.original_url &&
                /^https?:\/\//i.test(source.original_url) && (
                  <a
                    className="source-link"
                    href={source.original_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {source.original_url} ↗
                  </a>
                )}
              {source.original_text && (
                <details>
                  <summary>텍스트 내용 보기</summary>
                  <p className="source-text">{source.original_text}</p>
                </details>
              )}
              {source.error_message && (
                <p className="error-text">{source.error_message}</p>
              )}
              <p className="small muted">{formatSeoul(source.created_at)}</p>
            </article>
          ))}
        </div>
      )}
      <Pagination page={page} count={data?.length ?? 0} onChange={onChange} />
    </>
  );
}
