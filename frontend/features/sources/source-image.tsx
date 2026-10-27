"use client";
import { useEffect, useState } from "react";
import { sourcesApi } from "./api";
import styles from "./source-image.module.css";

export function SourceImage({ id }: { id: string }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    sourcesApi
      .image(id, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);
  return (
    <section className="card" aria-label="원본 이미지">
      <h2>원본 이미지</h2>
      {failed ? (
        <p>이미지를 불러오지 못했습니다. 자료 상태를 확인해 주세요.</p>
      ) : url ? (
        // Authenticated Blob; a public Next image optimizer must never fetch this upload.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={styles.image}
          src={url}
          alt="등록한 일정 이미지. 아래 추출 결과와 날짜를 비교해 주세요."
        />
      ) : (
        <p role="status">이미지를 불러오고 있습니다.</p>
      )}
    </section>
  );
}
