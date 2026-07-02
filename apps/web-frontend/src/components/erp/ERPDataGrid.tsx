import { type ReactNode, useState } from 'react';
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { ERPTableSkeleton } from './ERPSkeleton.js';
import ERPEmptyState from './ERPEmptyState.js';
import ERPPagination from './ERPPagination.js';

export interface ERPColumnDef<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
  width?: string | number;
  mono?: boolean;
  className?: string;
}

export interface ERPPaginationState {
  page: number;
  pageSize: number;
  total: number;
}

type SortDir = 'asc' | 'desc';

interface Props<T> {
  columns: ERPColumnDef<T>[];
  data: T[];
  isLoading?: boolean;
  emptyState?: ReactNode;
  pagination?: ERPPaginationState;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  rowKey: keyof T | ((row: T) => string | number);
  density?: 'compact' | 'comfortable' | 'spacious';
  stickyHeader?: boolean;
  footer?: ReactNode;
  toolbar?: ReactNode;
  onRowClick?: (row: T) => void;
  className?: string;
}

const DENSITY_CLASSES = {
  compact: 'py-1.5',
  comfortable: 'py-2.5',
  spacious: 'py-4',
};

export default function ERPDataGrid<T>({
  columns,
  data,
  isLoading = false,
  emptyState,
  pagination,
  onPageChange,
  onPageSizeChange,
  rowKey,
  density = 'comfortable',
  stickyHeader = true,
  footer,
  toolbar,
  onRowClick,
  className = '',
}: Props<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  function getRowKey(row: T): string | number {
    return typeof rowKey === 'function' ? rowKey(row) : (row[rowKey] as string | number);
  }

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const sortedData = sortKey
    ? [...data].sort((a, b) => {
        const av = (a as Record<string, unknown>)[sortKey];
        const bv = (b as Record<string, unknown>)[sortKey];
        const cmp =
          typeof av === 'number' && typeof bv === 'number'
            ? av - bv
            : String(av ?? '').localeCompare(String(bv ?? ''));
        return sortDir === 'asc' ? cmp : -cmp;
      })
    : data;

  const rowPad = DENSITY_CLASSES[density];

  return (
    <div className={`bg-surface-card border border-default rounded-xl overflow-hidden ${className}`}>
      {toolbar && <div className="px-4 py-3 border-b border-default">{toolbar}</div>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className={`bg-surface-subtle border-b border-default ${stickyHeader ? 'sticky top-0 z-[--z-sticky]' : ''}`}>
            <tr>
              {columns.map((col) => {
                const isSorted = sortKey === col.key;
                const SortIcon = isSorted ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    style={col.width ? { width: col.width } : undefined}
                    className={`px-4 py-3 text-xs font-semibold text-secondary uppercase tracking-wide select-none
                      ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'}
                      ${col.sortable ? 'cursor-pointer hover:text-primary' : ''}`}
                    onClick={col.sortable ? () => handleSort(col.key) : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.header}
                      {col.sortable && (
                        <SortIcon
                          size={12}
                          className={isSorted ? 'text-brand' : 'text-disabled'}
                        />
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-default">
            {isLoading ? (
              <tr>
                <td colSpan={columns.length} className="p-0">
                  <ERPTableSkeleton rows={5} cols={columns.length} />
                </td>
              </tr>
            ) : sortedData.length === 0 ? (
              <tr>
                <td colSpan={columns.length}>
                  {emptyState ?? <ERPEmptyState type="no-data" />}
                </td>
              </tr>
            ) : (
              sortedData.map((row) => (
                <tr
                  key={getRowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`hover:bg-surface-raised transition-colors ${onRowClick ? 'cursor-pointer' : ''}`}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-4 ${rowPad} text-primary
                        ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''}
                        ${col.mono ? 'font-mono' : ''}
                        ${col.className ?? ''}`}
                    >
                      {col.render
                        ? col.render(row)
                        : String((row as Record<string, unknown>)[col.key] ?? '–')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
          {footer && (
            <tfoot>
              <tr className="bg-surface-subtle border-t border-default font-semibold">
                {footer}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {pagination && onPageChange && (
        <ERPPagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          onPageChange={onPageChange}
          {...(onPageSizeChange ? { onPageSizeChange } : {})}
        />
      )}
    </div>
  );
}
