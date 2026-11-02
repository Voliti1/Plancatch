export function Pagination({
  page,
  count,
  onChange,
  disabled = false,
  hasMore,
}: {
  page: number;
  count: number;
  onChange: (page: number) => void;
  disabled?: boolean;
  hasMore?: boolean;
}) {
  return (
    <div className="pagination">
      <button
        className="secondary"
        disabled={disabled || page === 0}
        onClick={() => onChange(page - 1)}
      >
        이전
      </button>
      <span>{page + 1} 페이지</span>
      <button
        className="secondary"
        disabled={disabled || (hasMore === undefined ? count < 50 : !hasMore)}
        onClick={() => onChange(page + 1)}
      >
        다음
      </button>
    </div>
  );
}
