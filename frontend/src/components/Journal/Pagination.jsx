// src/components/Journal/Pagination.jsx

export default function Pagination({ pagination, onPageChange }) {
  const { page, totalPages } = pagination;

  if (totalPages <= 1) return null;

  const pages = [];
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, page + 2);

  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  return (
    <div className="flex justify-center items-center gap-1 mt-4">
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        className="px-3 py-1 text-sm rounded-lg text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        ◀
      </button>
      {start > 1 && (
        <>
          <button onClick={() => onPageChange(1)} className="px-3 py-1 text-sm rounded-lg text-gray-400 hover:text-white hover:bg-white/10">1</button>
          {start > 2 && <span className="text-gray-500 px-1">...</span>}
        </>
      )}
      {pages.map((p) => (
        <button
          key={p}
          onClick={() => onPageChange(p)}
          className={`px-3 py-1 text-sm rounded-lg ${
            p === page
              ? "bg-emerald-600 text-white"
              : "text-gray-400 hover:text-white hover:bg-white/10"
          }`}
        >
          {p}
        </button>
      ))}
      {end < totalPages && (
        <>
          {end < totalPages - 1 && <span className="text-gray-500 px-1">...</span>}
          <button onClick={() => onPageChange(totalPages)} className="px-3 py-1 text-sm rounded-lg text-gray-400 hover:text-white hover:bg-white/10">{totalPages}</button>
        </>
      )}
      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        className="px-3 py-1 text-sm rounded-lg text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        ▶
      </button>
    </div>
  );
}
