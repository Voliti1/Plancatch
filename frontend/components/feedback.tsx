export function Loading() {
  return (
    <div className="notice" role="status">
      불러오는 중입니다…
    </div>
  );
}
export function ErrorNotice({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div className="notice error" role="alert">
      <p>{message}</p>
      {retry && (
        <button className="secondary" onClick={retry}>
          다시 시도
        </button>
      )}
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon" aria-hidden>
        ＋
      </span>
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}
