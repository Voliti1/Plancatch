export function Pagination({
  page,
  count,
  onChange,
}: {
  page: number;
  count: number;
  onChange: (page: number) => void;
}) {
  return (
    <div className="pagination">
      <button
        className="secondary"
        disabled={page === 0}
        onClick={() => onChange(page - 1)}
      >
        이전
      </button>
      <span>{page + 1} 페이지</span>
      <button
        className="secondary"
        disabled={count < 50}
        onClick={() => onChange(page + 1)}
      >
        다음
      </button>
    </div>
  );
}
