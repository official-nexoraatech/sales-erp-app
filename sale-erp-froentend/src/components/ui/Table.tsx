import React from 'react';

export interface TableColumn<T> {
  key: keyof T | string;
  header: string;
  render?: (value: any, record: T, index: number) => React.ReactNode;
  width?: string;
  align?: 'left' | 'center' | 'right';
  className?: string;
  headerClassName?: string;
}

interface TableProps<T> {
  columns: TableColumn<T>[];
  data: T[];
  isLoading?: boolean;
  emptyMessage?: string;
  className?: string;
  rowKey?: (record: T, index: number) => string | number;
  onRowClick?: (record: T) => void;
  striped?: boolean;
}

const alignClass = { left: 'text-left', center: 'text-center', right: 'text-right' };

export const Table = React.forwardRef<HTMLTableElement, TableProps<any>>(
  (
    {
      columns,
      data,
      isLoading = false,
      emptyMessage = 'No data available',
      className = '',
      rowKey,
      onRowClick,
      striped = true,
    },
    ref,
  ) => {
    if (isLoading) {
      return (
        <div className="space-y-2 p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-slate-100 dark:bg-slate-700" />
          ))}
        </div>
      );
    }

    if (data.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="mb-3 text-slate-300 dark:text-slate-600">
            <svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
          </div>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{emptyMessage}</p>
        </div>
      );
    }

    return (
      <div className="overflow-x-auto">
        <table ref={ref} className={`w-full text-sm ${className}`}>
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
              {columns.map((col, idx) => (
                <th
                  key={idx}
                  className={[
                    'px-4 py-3 text-xs font-semibold uppercase tracking-wide',
                    'text-slate-600 dark:text-slate-400',
                    alignClass[col.align ?? 'left'],
                    col.headerClassName ?? '',
                  ].join(' ')}
                  style={{ width: col.width }}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {data.map((record, rowIdx) => (
              <tr
                key={rowKey ? rowKey(record, rowIdx) : rowIdx}
                onClick={onRowClick ? () => onRowClick(record) : undefined}
                className={[
                  'transition-colors duration-100',
                  striped && rowIdx % 2 === 1
                    ? 'bg-slate-50/60 dark:bg-slate-900/30'
                    : 'bg-white dark:bg-transparent',
                  onRowClick ? 'cursor-pointer' : '',
                  'hover:bg-blue-50/60 dark:hover:bg-slate-700/40',
                ].join(' ')}
              >
                {columns.map((col, colIdx) => (
                  <td
                    key={colIdx}
                    className={[
                      'px-4 py-3 text-slate-700 dark:text-slate-300',
                      alignClass[col.align ?? 'left'],
                      col.className ?? '',
                    ].join(' ')}
                  >
                    {col.render
                      ? col.render(record[col.key as string], record, rowIdx)
                      : record[col.key as string]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  },
);

Table.displayName = 'Table';
