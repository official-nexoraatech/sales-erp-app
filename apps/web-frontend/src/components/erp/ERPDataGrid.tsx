import { type ReactNode, type ComponentType, useState, useEffect } from 'react';
import { ArrowUp, ArrowDown, ArrowUpDown, X, Columns3, Check } from 'lucide-react';
import { ERPTableSkeleton } from './ERPSkeleton.js';
import ERPEmptyState from './ERPEmptyState.js';
import ERPPagination from './ERPPagination.js';
import ERPDropdownMenu, { type ERPMenuItem } from './ERPDropdownMenu.js';
import Button from '../ui/Button.js';
import { useUIStore } from '../../store/ui.store.js';

export interface ERPColumnDef<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
  width?: string | number;
  mono?: boolean;
  className?: string;
  sticky?: 'right';
  /** Set false on the primary identifying column — per
   * ERP-PLANNING/03_ERP_DESIGN_SYSTEM.md Part 3, it's never hideable. Only takes effect
   * when `tableId` is set (column visibility is opt-in — see Props.tableId). */
  hideable?: boolean;
}

export interface ERPPaginationState {
  page: number;
  pageSize: number;
  total: number;
}

type SortDir = 'asc' | 'desc';
type RowKeyValue = string | number;

export interface ERPBulkAction {
  label: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
  onClick: (selectedKeys: RowKeyValue[]) => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'outline';
}

interface Props<T> {
  columns: ERPColumnDef<T>[];
  data: T[];
  isLoading?: boolean;
  emptyState?: ReactNode;
  pagination?: ERPPaginationState;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  rowKey: keyof T | ((row: T) => string | number);
  /** Falls back to the user's global density preference (ERP-PLANNING/05_ERP_THEME_SYSTEM.md
   * §6) when not explicitly set — pass this prop only to override it for a specific table. */
  density?: 'compact' | 'comfortable' | 'spacious';
  stickyHeader?: boolean;
  footer?: ReactNode;
  toolbar?: ReactNode;
  onRowClick?: (row: T) => void;
  className?: string;
  /** Per ERP-PLANNING/03_ERP_DESIGN_SYSTEM.md Part 3 — row checkboxes + a bulk-action bar
   * that replaces `toolbar` while any row is selected. Selection state is caller-owned
   * (same pattern as `pagination`) so it can be reset on filter/page change if needed. */
  selectedKeys?: Set<RowKeyValue>;
  onSelectionChange?: (keys: Set<RowKeyValue>) => void;
  bulkActions?: ERPBulkAction[];
  /** Opt-in column-visibility toggle (ERP-PLANNING/03_ERP_DESIGN_SYSTEM.md Part 3). Pass a
   * stable per-table id to enable the "Columns" control and persist the hidden-column set to
   * localStorage under it; omit to leave the table exactly as it renders today. */
  tableId?: string;
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
  density,
  stickyHeader = true,
  footer,
  toolbar,
  onRowClick,
  className = '',
  selectedKeys,
  onSelectionChange,
  bulkActions,
  tableId,
}: Props<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const globalDensity = useUIStore((s) => s.density);
  const effectiveDensity = density ?? globalDensity;
  const selectable = Boolean(selectedKeys && onSelectionChange);

  const storageKey = tableId ? `erp-table-columns-${tableId}` : null;
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(() => {
    if (!storageKey || typeof localStorage === 'undefined') return new Set();
    try {
      const stored = localStorage.getItem(storageKey);
      return stored ? new Set(JSON.parse(stored) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    if (!storageKey) return;
    localStorage.setItem(storageKey, JSON.stringify(Array.from(hiddenCols)));
  }, [storageKey, hiddenCols]);

  function toggleColumn(key: string) {
    setHiddenCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const visibleColumns = storageKey
    ? columns.filter((c) => c.hideable === false || !hiddenCols.has(c.key))
    : columns;

  function getRowKey(row: T): string | number {
    return typeof rowKey === 'function' ? rowKey(row) : (row[rowKey] as string | number);
  }

  function toggleRow(key: RowKeyValue) {
    if (!selectedKeys || !onSelectionChange) return;
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key); else next.add(key);
    onSelectionChange(next);
  }

  function toggleAll(keys: RowKeyValue[]) {
    if (!selectedKeys || !onSelectionChange) return;
    const allSelected = keys.length > 0 && keys.every((k) => selectedKeys.has(k));
    onSelectionChange(allSelected ? new Set() : new Set(keys));
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

  const rowPad = DENSITY_CLASSES[effectiveDensity];
  const rowKeys = sortedData.map(getRowKey);
  const selectedCount = selectedKeys?.size ?? 0;
  const colCount = visibleColumns.length + (selectable ? 1 : 0);

  const columnMenuItems: ERPMenuItem[] = columns.map((c) => ({
    label: c.header || c.key,
    ...(hiddenCols.has(c.key) ? {} : { icon: Check }),
    disabled: c.hideable === false,
    onClick: () => toggleColumn(c.key),
  }));

  return (
    <div className={`bg-surface-card border border-default rounded-xl overflow-hidden ${className}`}>
      {selectable && selectedCount > 0 && bulkActions ? (
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-default bg-primary-subtle">
          <span className="text-sm font-medium text-primary">{selectedCount} selected</span>
          <div className="flex items-center gap-2">
            {bulkActions.map((action) => {
              const Icon = action.icon;
              return (
                <Button
                  key={action.label}
                  size="sm"
                  variant={action.variant ?? 'secondary'}
                  onClick={() => action.onClick(Array.from(selectedKeys ?? []))}
                >
                  {Icon && <Icon size={14} />}
                  {action.label}
                </Button>
              );
            })}
          </div>
          <button
            onClick={() => onSelectionChange?.(new Set())}
            aria-label="Clear selection"
            className="ml-auto text-secondary hover:text-primary transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      ) : (toolbar || storageKey) ? (
        <div className="flex items-center gap-3 px-4 py-3 border-b border-default">
          {toolbar && <div className="flex-1">{toolbar}</div>}
          {storageKey && (
            <div className="ml-auto">
              <ERPDropdownMenu
                items={columnMenuItems}
                ariaLabel="Toggle column visibility"
                trigger={
                  <span className="flex items-center gap-1.5 text-sm text-secondary">
                    <Columns3 size={14} /> Columns
                  </span>
                }
              />
            </div>
          )}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead className={`bg-surface-subtle ${stickyHeader ? 'sticky top-0 z-[--z-sticky]' : ''}`}>
            <tr>
              {selectable && (
                <th scope="col" className="w-10 px-4 py-3 border-b border-default">
                  <input
                    type="checkbox"
                    aria-label="Select all rows"
                    checked={rowKeys.length > 0 && rowKeys.every((k) => selectedKeys?.has(k))}
                    onChange={() => toggleAll(rowKeys)}
                    className="rounded border-default"
                  />
                </th>
              )}
              {visibleColumns.map((col) => {
                const isSorted = sortKey === col.key;
                const SortIcon = isSorted ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    style={col.width ? { width: col.width } : undefined}
                    className={`px-4 py-3 text-xs font-semibold text-secondary uppercase tracking-wide select-none border-b border-default
                      ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'}
                      ${col.sortable ? 'cursor-pointer hover:text-primary' : ''}
                      ${col.sticky === 'right' ? 'sticky right-0 z-10 bg-surface-subtle' : ''}`}
                    onClick={col.sortable ? () => handleSort(col.key) : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.header || <span className="sr-only">Actions</span>}
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
          <tbody className="[&>tr:not(:last-child)>td]:border-b [&>tr:not(:last-child)>td]:border-default">
            {isLoading ? (
              <tr>
                <td colSpan={colCount} className="p-0">
                  <ERPTableSkeleton rows={5} cols={colCount} />
                </td>
              </tr>
            ) : sortedData.length === 0 ? (
              <tr>
                <td colSpan={colCount}>
                  {emptyState ?? <ERPEmptyState type="no-data" />}
                </td>
              </tr>
            ) : (
              sortedData.map((row) => {
                const key = getRowKey(row);
                return (
                <tr
                  key={key}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`group hover:bg-surface-raised transition-colors ${onRowClick ? 'cursor-pointer' : ''} ${selectedKeys?.has(key) ? 'bg-primary-subtle' : ''}`}
                >
                  {selectable && (
                    <td className={`px-4 ${rowPad}`} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label="Select row"
                        checked={selectedKeys?.has(key) ?? false}
                        onChange={() => toggleRow(key)}
                        className="rounded border-default"
                      />
                    </td>
                  )}
                  {visibleColumns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-4 ${rowPad} text-primary
                        ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''}
                        ${col.mono ? 'font-mono' : ''}
                        ${col.sticky === 'right' ? 'sticky right-0 z-10 bg-surface-card group-hover:bg-surface-raised' : ''}
                        ${col.className ?? ''}`}
                    >
                      {col.render
                        ? col.render(row)
                        : String((row as Record<string, unknown>)[col.key] ?? '–')}
                    </td>
                  ))}
                </tr>
                );
              })
            )}
          </tbody>
          {footer && (
            <tfoot className="shadow-[inset_0_1px_0_0_var(--border-default)]">
              <tr className="bg-surface-subtle font-semibold">
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
