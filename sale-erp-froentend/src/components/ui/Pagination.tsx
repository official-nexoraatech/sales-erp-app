import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  showPageNumbers?: boolean;
}

const btnBase =
  'inline-flex h-8 w-8 items-center justify-center rounded-lg border text-sm transition-colors ' +
  'disabled:pointer-events-none disabled:opacity-40 ' +
  'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:border-slate-300 active:bg-slate-100 ' +
  'dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:border-slate-600 dark:active:bg-slate-600';

export const Pagination: React.FC<PaginationProps> = ({
  page,
  totalPages,
  onPageChange,
  showPageNumbers = false,
}) => {
  const getPageNumbers = () => {
    const delta = 1;
    const range: (number | '...')[] = [];
    for (let i = Math.max(0, page - delta); i <= Math.min(totalPages - 1, page + delta); i++) {
      range.push(i);
    }
    if (range[0] !== 0) {
      if (range[0] !== 1) range.unshift('...');
      range.unshift(0);
    }
    if (range[range.length - 1] !== totalPages - 1) {
      if (range[range.length - 1] !== totalPages - 2) range.push('...');
      range.push(totalPages - 1);
    }
    return range;
  };

  return (
    <nav aria-label="Pagination" className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => onPageChange(page - 1)}
        disabled={page === 0}
        aria-label="Previous page"
        className={btnBase}
      >
        <ChevronLeft size={15} />
      </button>

      {showPageNumbers && totalPages > 1
        ? getPageNumbers().map((p, idx) =>
            p === '...' ? (
              <span key={`ellipsis-${idx}`} className="px-1 text-sm text-slate-400 dark:text-slate-500">
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => onPageChange(p as number)}
                aria-label={`Page ${(p as number) + 1}`}
                aria-current={p === page ? 'page' : undefined}
                className={[
                  'inline-flex h-8 w-8 items-center justify-center rounded-lg border text-sm font-medium transition-colors',
                  p === page
                    ? 'border-blue-600 bg-blue-600 text-white dark:border-blue-500 dark:bg-blue-500'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
                ].join(' ')}
              >
                {(p as number) + 1}
              </button>
            ),
          )
        : (
          <span className="px-2 text-sm text-slate-600 dark:text-slate-400">
            Page {page + 1} of {totalPages}
          </span>
        )}

      <button
        type="button"
        onClick={() => onPageChange(page + 1)}
        disabled={page + 1 >= totalPages}
        aria-label="Next page"
        className={btnBase}
      >
        <ChevronRight size={15} />
      </button>
    </nav>
  );
};
