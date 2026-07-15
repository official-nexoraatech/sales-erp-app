import { type ReactNode, type ComponentType, type CSSProperties, useState, useEffect } from 'react';
import { List, type RowComponentProps } from 'react-window';
import {
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  X,
  Columns3,
  Check,
  Download,
  Printer,
  RefreshCw,
} from 'lucide-react';
import { ERPTableSkeleton } from './ERPSkeleton.js';
import ERPEmptyState from './ERPEmptyState.js';
import ERPPagination from './ERPPagination.js';
import ERPDropdownMenu, { type ERPMenuItem } from './ERPDropdownMenu.js';
import Button from '../ui/Button.js';
import { useUIStore } from '../../store/ui.store.js';
import { useMediaQuery, BREAKPOINTS } from '../../hooks/useMediaQuery.js';
import { toCsv, downloadCsv } from './erpTableExport.js';

export interface ERPColumnDef<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
  width?: string | number;
  mono?: boolean;
  className?: string;
  /** 'right' pins the column while scrolling horizontally (the classic frozen actions
   * column); 'left' pins a leading column (e.g. row number / code) — offset automatically
   * accounts for the selection checkbox column when both are present. */
  sticky?: 'left' | 'right';
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

/** Semantic color for a row action icon — matches the standard ERP action vocabulary
 * (view/edit/duplicate/print/download/delete). Anything else (Approve, Submit, Cancel,
 * Attachments, …) uses 'default' (neutral gray) rather than being forced into one of these. */
export type ERPRowActionType =
  'view' | 'edit' | 'duplicate' | 'print' | 'download' | 'delete' | 'default';

/** Standardized, always-visible row-action icon button, rendered in a sticky right-hand
 * column — no ⋯ dropdown. Every table gets this via ERPDataGrid's `actions` prop instead
 * of a page hand-rolling its own action column with an ERPDropdownMenu. */
export interface ERPRowAction<T> {
  icon: ComponentType<{ size?: number; className?: string }>;
  label: string;
  onClick: (row: T) => void;
  type?: ERPRowActionType;
  hidden?: (row: T) => boolean;
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
  /** Standardized icon-button action column — see ERPRowAction. Omit to keep hand-rolled
   * action columns (e.g. an ERPDropdownMenu inside a column's `render`) working as-is. */
  actions?: ERPRowAction<T>[];
  /** Adds a CSV export button to the toolbar row; exports the currently visible columns
   * and rows (client-side, no server round-trip). */
  enableExport?: boolean;
  exportFilename?: string;
  /** Adds a print button that opens the browser print dialog scoped to just this table. */
  enablePrint?: boolean;
  /** Adds a refresh button to the toolbar row; caller owns the actual refetch. */
  onRefresh?: () => void;
  /** When provided, sort clicks call this instead of sorting `data` locally — pair with
   * `sortState` so the header icon reflects the server's actual applied sort. */
  onSortChange?: (key: string, dir: SortDir) => void;
  sortState?: { key: string; dir: SortDir };
  /** Row-virtualizes the body (via react-window) instead of rendering every row — for the
   * rare page that loads hundreds/thousands of rows without server pagination. Most tables
   * already page server-side and don't need this. Renders as a CSS-grid body (not a native
   * <table>) since absolutely-positioned virtual rows can't participate in table layout;
   * column alignment is preserved by sharing one grid-template-columns across header+rows. */
  virtualized?: boolean;
  /** Height (px) of the scrollable virtualized body. Only used when `virtualized` is true. */
  virtualizedHeight?: number;
}

const DENSITY_CLASSES = {
  compact: 'py-1.5',
  comfortable: 'py-3',
  spacious: 'py-4',
};

const DENSITY_ROW_PX = {
  compact: 40,
  comfortable: 52,
  spacious: 64,
};

const STICKY_RIGHT_SHADOW = 'shadow-[-4px_0_6px_-4px_rgb(0_0_0_/_0.08)]';
const STICKY_LEFT_SHADOW = 'shadow-[4px_0_6px_-4px_rgb(0_0_0_/_0.08)]';

const MAX_INLINE_ACTIONS = 4;

const ACTION_TYPE_CLASSES: Record<ERPRowActionType, string> = {
  view: 'text-info hover:bg-info-bg',
  edit: 'text-success hover:bg-success-bg',
  duplicate: 'text-accent-purple hover:bg-accent-purple-subtle',
  print: 'text-secondary hover:bg-surface-raised hover:text-primary',
  download: 'text-brand hover:bg-primary-subtle',
  delete: 'text-danger hover:bg-danger-bg',
  default: 'text-secondary hover:bg-surface-raised hover:text-primary',
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
  actions,
  enableExport = false,
  exportFilename = 'export',
  enablePrint = false,
  onRefresh,
  onSortChange,
  sortState,
  virtualized = false,
  virtualizedHeight = 480,
}: Props<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const globalDensity = useUIStore((s) => s.density);
  const effectiveDensity = density ?? globalDensity;
  const selectable = Boolean(selectedKeys && onSelectionChange);
  // Renders either the table or the stacked-card layout, never both — a CSS-only
  // hidden/sm:block dual-render would mount every row twice (each col.render() firing
  // twice per row, and duplicate text nodes wherever a test or a11y tool queries by
  // content), so the breakpoint is resolved at runtime instead.
  const isMobile = useMediaQuery(BREAKPOINTS.mobile);
  const hasActions = Boolean(actions && actions.length > 0);

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
      if (next.has(key)) next.delete(key);
      else next.add(key);
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
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectionChange(next);
  }

  function toggleAll(keys: RowKeyValue[]) {
    if (!selectedKeys || !onSelectionChange) return;
    const allSelected = keys.length > 0 && keys.every((k) => selectedKeys.has(k));
    onSelectionChange(allSelected ? new Set() : new Set(keys));
  }

  const effectiveSortKey = sortState ? sortState.key : sortKey;
  const effectiveSortDir = sortState ? sortState.dir : sortDir;

  function handleSort(key: string) {
    if (onSortChange) {
      const nextDir: SortDir =
        effectiveSortKey === key && effectiveSortDir === 'asc' ? 'desc' : 'asc';
      onSortChange(key, nextDir);
      return;
    }
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  // Server-driven sort (onSortChange) means `data` arrives pre-sorted — sorting it again
  // locally here would fight the caller's own order.
  const sortedData = onSortChange
    ? data
    : sortKey
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
  const colCount = visibleColumns.length + (selectable ? 1 : 0) + (hasActions ? 1 : 0);

  const columnMenuItems: ERPMenuItem[] = columns.map((c) => ({
    label: c.header || c.key,
    ...(hiddenCols.has(c.key) ? {} : { icon: Check }),
    disabled: c.hideable === false,
    onClick: () => toggleColumn(c.key),
  }));

  function stickyLeftClass(col: ERPColumnDef<T>): string {
    if (col.sticky !== 'left') return '';
    // Offset by the checkbox column's width so a pinned data column doesn't sit under it.
    return `sticky ${selectable ? 'left-10' : 'left-0'} z-10 ${STICKY_LEFT_SHADOW}`;
  }

  function handleExport() {
    const csv = toCsv(visibleColumns, sortedData);
    downloadCsv(exportFilename, csv);
  }

  function renderRowActions(row: T) {
    if (!actions) return null;
    const visible = actions.filter((a) => !a.hidden || !a.hidden(row));
    if (visible.length === 0) return null;
    // Every action is a one-click icon button, never behind a ⋯ menu — but a handful of
    // pages have more status-gated actions than can fit in a row without wrapping or
    // pushing the column too wide. Past MAX_INLINE_ACTIONS, the least-common ones fold into
    // a single overflow menu instead; the common ones (first in the caller's list) stay
    // one-click. No table in this app currently exceeds this in practice.
    const inline =
      visible.length > MAX_INLINE_ACTIONS ? visible.slice(0, MAX_INLINE_ACTIONS - 1) : visible;
    const overflow =
      visible.length > MAX_INLINE_ACTIONS ? visible.slice(MAX_INLINE_ACTIONS - 1) : [];
    return (
      <div className="flex items-center justify-end gap-2">
        {inline.map((a) => {
          const Icon = a.icon;
          return (
            <button
              key={a.label}
              type="button"
              title={a.label}
              aria-label={a.label}
              onClick={(e) => {
                e.stopPropagation();
                a.onClick(row);
              }}
              className={`inline-flex items-center justify-center w-9 h-9 rounded-md transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus ${ACTION_TYPE_CLASSES[a.type ?? 'default']}`}
            >
              <Icon size={16} />
            </button>
          );
        })}
        {overflow.length > 0 && (
          <ERPDropdownMenu
            ariaLabel="More actions"
            items={overflow.map((a) => ({
              label: a.label,
              icon: a.icon,
              variant: a.type === 'delete' ? 'danger' : 'default',
              onClick: () => a.onClick(row),
            }))}
          />
        )}
      </div>
    );
  }

  function isLastVisibleCol(idx: number): boolean {
    return idx === visibleColumns.length - 1 && !hasActions;
  }

  const showToolbarRow = Boolean(toolbar || storageKey || enableExport || enablePrint || onRefresh);

  return (
    <div
      className={`bg-surface-card border border-default rounded-xl overflow-hidden ${enablePrint ? 'erp-print-area' : ''} ${className}`}
    >
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
      ) : showToolbarRow ? (
        <div className="flex items-center gap-3 px-4 py-3 border-b border-default">
          {toolbar && <div className="flex-1">{toolbar}</div>}
          <div className={`flex items-center gap-1 ${toolbar ? '' : 'ml-auto'}`}>
            {onRefresh && (
              <button
                type="button"
                title="Refresh"
                aria-label="Refresh"
                onClick={onRefresh}
                className="p-1.5 rounded-md text-secondary hover:bg-surface-raised hover:text-primary transition-colors"
              >
                <RefreshCw size={15} />
              </button>
            )}
            {enableExport && (
              <button
                type="button"
                title="Export CSV"
                aria-label="Export CSV"
                onClick={handleExport}
                className="p-1.5 rounded-md text-secondary hover:bg-surface-raised hover:text-primary transition-colors"
              >
                <Download size={15} />
              </button>
            )}
            {enablePrint && (
              <button
                type="button"
                title="Print"
                aria-label="Print"
                onClick={() => window.print()}
                className="p-1.5 rounded-md text-secondary hover:bg-surface-raised hover:text-primary transition-colors"
              >
                <Printer size={15} />
              </button>
            )}
            {storageKey && (
              <ERPDropdownMenu
                items={columnMenuItems}
                ariaLabel="Toggle column visibility"
                trigger={
                  <span className="flex items-center gap-1.5 text-sm text-secondary">
                    <Columns3 size={14} /> Columns
                  </span>
                }
              />
            )}
          </div>
        </div>
      ) : null}

      {virtualized ? (
        <VirtualizedGrid
          columns={visibleColumns}
          data={sortedData}
          isLoading={isLoading}
          emptyState={emptyState}
          colCount={colCount}
          selectable={selectable}
          selectedKeys={selectedKeys}
          toggleRow={toggleRow}
          toggleAll={toggleAll}
          rowKeys={rowKeys}
          getRowKey={getRowKey}
          onRowClick={onRowClick}
          hasActions={hasActions}
          renderRowActions={renderRowActions}
          effectiveSortKey={effectiveSortKey}
          effectiveSortDir={effectiveSortDir}
          handleSort={handleSort}
          rowHeightPx={DENSITY_ROW_PX[effectiveDensity]}
          height={virtualizedHeight}
        />
      ) : isMobile ? (
        /* Mobile: stacked-card hybrid view — each row becomes a labeled card instead of
           a horizontally-scrolling table, per ERP-PLANNING responsive requirements. Gated
           on the actual viewport (not a CSS hidden/sm:block dual-render) so only one
           layout is ever mounted at a time. */
        <div className="divide-y divide-default">
          {isLoading ? (
            <ERPTableSkeleton rows={5} cols={3} />
          ) : sortedData.length === 0 ? (
            (emptyState ?? <ERPEmptyState type="no-data" />)
          ) : (
            sortedData.map((row) => {
              const key = getRowKey(row);
              return (
                <div
                  key={key}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`p-4 space-y-2 ${onRowClick ? 'cursor-pointer active:bg-surface-raised' : ''} ${selectedKeys?.has(key) ? 'bg-primary-subtle' : ''}`}
                >
                  {selectable && (
                    <div onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label="Select row"
                        checked={selectedKeys?.has(key) ?? false}
                        onChange={() => toggleRow(key)}
                        className="rounded border-default"
                      />
                    </div>
                  )}
                  {visibleColumns.map((col) => (
                    <div key={col.key} className="flex items-start justify-between gap-3 text-sm">
                      <span className="text-secondary text-xs uppercase tracking-wide shrink-0 pt-0.5">
                        {col.header}
                      </span>
                      <span className={`text-primary text-right ${col.mono ? 'font-mono' : ''}`}>
                        {col.render
                          ? col.render(row)
                          : String((row as Record<string, unknown>)[col.key] ?? '–')}
                      </span>
                    </div>
                  ))}
                  {hasActions && (
                    <div className="pt-2" onClick={(e) => e.stopPropagation()}>
                      {renderRowActions(row)}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead
              className={`bg-surface-subtle ${stickyHeader ? 'sticky top-0 z-[--z-sticky]' : ''}`}
            >
              <tr>
                {selectable && (
                  <th scope="col" className="w-10 px-4 py-3 border-b border-r border-default">
                    <input
                      type="checkbox"
                      aria-label="Select all rows"
                      checked={rowKeys.length > 0 && rowKeys.every((k) => selectedKeys?.has(k))}
                      onChange={() => toggleAll(rowKeys)}
                      className="rounded border-default"
                    />
                  </th>
                )}
                {visibleColumns.map((col, idx) => {
                  const isSorted = effectiveSortKey === col.key;
                  const SortIcon = isSorted
                    ? effectiveSortDir === 'asc'
                      ? ArrowUp
                      : ArrowDown
                    : ArrowUpDown;
                  return (
                    <th
                      key={col.key}
                      scope="col"
                      style={col.width ? { width: col.width } : undefined}
                      className={`px-4 py-3 text-xs font-semibold text-secondary uppercase tracking-wide select-none border-b border-default
                        ${isLastVisibleCol(idx) ? '' : 'border-r'}
                        ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'}
                        ${col.sortable ? 'cursor-pointer hover:text-primary' : ''}
                        ${col.sticky === 'right' ? `sticky right-0 z-10 bg-surface-subtle ${STICKY_RIGHT_SHADOW}` : stickyLeftClass(col)}`}
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
                {hasActions && (
                  <th
                    scope="col"
                    className={`w-px px-2 py-3 border-b border-default sticky right-0 z-10 bg-surface-subtle ${STICKY_RIGHT_SHADOW}`}
                  >
                    <span className="sr-only">Actions</span>
                  </th>
                )}
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
                  <td colSpan={colCount}>{emptyState ?? <ERPEmptyState type="no-data" />}</td>
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
                        <td
                          className={`px-4 border-r border-default ${rowPad}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            aria-label="Select row"
                            checked={selectedKeys?.has(key) ?? false}
                            onChange={() => toggleRow(key)}
                            className="rounded border-default"
                          />
                        </td>
                      )}
                      {visibleColumns.map((col, idx) => (
                        <td
                          key={col.key}
                          className={`px-4 ${rowPad} text-primary
                          ${isLastVisibleCol(idx) ? '' : 'border-r border-default'}
                          ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''}
                          ${col.mono ? 'font-mono' : ''}
                          ${col.sticky === 'right' ? `sticky right-0 z-10 bg-surface-card group-hover:bg-surface-raised ${STICKY_RIGHT_SHADOW}` : col.sticky === 'left' ? `${stickyLeftClass(col)} bg-surface-card group-hover:bg-surface-raised` : ''}
                          ${col.className ?? ''}`}
                        >
                          {col.render
                            ? col.render(row)
                            : String((row as Record<string, unknown>)[col.key] ?? '–')}
                        </td>
                      ))}
                      {hasActions && (
                        <td
                          className={`px-2 ${rowPad} sticky right-0 z-10 bg-surface-card group-hover:bg-surface-raised ${STICKY_RIGHT_SHADOW}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {renderRowActions(row)}
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
            {footer && (
              <tfoot className="shadow-[inset_0_1px_0_0_var(--border-default)]">
                <tr className="bg-surface-subtle font-semibold">{footer}</tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

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

interface VirtualRowProps<T> {
  data: T[];
  columns: ERPColumnDef<T>[];
  templateColumns: string;
  hasActions: boolean;
  renderRowActions: (row: T) => ReactNode;
  selectable: boolean;
  selectedKeys?: Set<RowKeyValue> | undefined;
  toggleRow: (key: RowKeyValue) => void;
  getRowKey: (row: T) => RowKeyValue;
  onRowClick?: ((row: T) => void) | undefined;
}

function VirtualRow<T>({
  index,
  style,
  data,
  columns,
  templateColumns,
  hasActions,
  renderRowActions,
  selectable,
  selectedKeys,
  toggleRow,
  getRowKey,
  onRowClick,
}: RowComponentProps<VirtualRowProps<T>>) {
  // react-window guarantees `index` is within [0, rowCount) — rowCount is always data.length.
  const row = data[index]!;
  const key = getRowKey(row);
  const gridStyle: CSSProperties = {
    ...style,
    display: 'grid',
    gridTemplateColumns: templateColumns,
  };
  return (
    <div
      style={gridStyle}
      onClick={onRowClick ? () => onRowClick(row) : undefined}
      className={`items-center border-b border-default group hover:bg-surface-raised transition-colors ${onRowClick ? 'cursor-pointer' : ''} ${selectedKeys?.has(key) ? 'bg-primary-subtle' : ''} bg-surface-card`}
    >
      {selectable && (
        <div
          className="px-4 border-r border-default h-full flex items-center"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            aria-label="Select row"
            checked={selectedKeys?.has(key) ?? false}
            onChange={() => toggleRow(key)}
            className="rounded border-default"
          />
        </div>
      )}
      {columns.map((col, idx) => (
        <div
          key={col.key}
          className={`px-4 text-primary text-sm truncate
            ${idx === columns.length - 1 && !hasActions ? '' : 'border-r border-default'}
            ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''}
            ${col.mono ? 'font-mono' : ''}`}
        >
          {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? '–')}
        </div>
      ))}
      {hasActions && (
        <div
          className={`px-2 sticky right-0 z-10 bg-surface-card group-hover:bg-surface-raised ${STICKY_RIGHT_SHADOW}`}
          onClick={(e) => e.stopPropagation()}
        >
          {renderRowActions(row)}
        </div>
      )}
    </div>
  );
}

interface VirtualizedGridProps<T> {
  columns: ERPColumnDef<T>[];
  data: T[];
  isLoading: boolean;
  emptyState?: ReactNode;
  colCount: number;
  selectable: boolean;
  selectedKeys?: Set<RowKeyValue> | undefined;
  toggleRow: (key: RowKeyValue) => void;
  toggleAll: (keys: RowKeyValue[]) => void;
  rowKeys: RowKeyValue[];
  getRowKey: (row: T) => RowKeyValue;
  onRowClick?: ((row: T) => void) | undefined;
  hasActions: boolean;
  renderRowActions: (row: T) => ReactNode;
  effectiveSortKey: string | null;
  effectiveSortDir: SortDir;
  handleSort: (key: string) => void;
  rowHeightPx: number;
  height: number;
}

function VirtualizedGrid<T>({
  columns,
  data,
  isLoading,
  emptyState,
  colCount,
  selectable,
  selectedKeys,
  toggleRow,
  toggleAll,
  rowKeys,
  getRowKey,
  onRowClick,
  hasActions,
  renderRowActions,
  effectiveSortKey,
  effectiveSortDir,
  handleSort,
  rowHeightPx,
  height,
}: VirtualizedGridProps<T>) {
  const templateColumns = [
    selectable ? '40px' : null,
    ...columns.map((c) =>
      c.width ? (typeof c.width === 'number' ? `${c.width}px` : c.width) : 'minmax(140px,1fr)'
    ),
    hasActions ? '112px' : null,
  ]
    .filter(Boolean)
    .join(' ');

  if (isLoading) return <ERPTableSkeleton rows={5} cols={colCount} />;
  if (data.length === 0) return <>{emptyState ?? <ERPEmptyState type="no-data" />}</>;

  return (
    <div className="overflow-x-auto">
      <div
        style={{ display: 'grid', gridTemplateColumns: templateColumns, minWidth: 'max-content' }}
        className="bg-surface-subtle border-b border-default"
      >
        {selectable && (
          <div className="w-10 px-4 py-3 border-r border-default flex items-center">
            <input
              type="checkbox"
              aria-label="Select all rows"
              checked={rowKeys.length > 0 && rowKeys.every((k) => selectedKeys?.has(k))}
              onChange={() => toggleAll(rowKeys)}
              className="rounded border-default"
            />
          </div>
        )}
        {columns.map((col, idx) => {
          const isSorted = effectiveSortKey === col.key;
          const SortIcon = isSorted
            ? effectiveSortDir === 'asc'
              ? ArrowUp
              : ArrowDown
            : ArrowUpDown;
          return (
            <div
              key={col.key}
              onClick={col.sortable ? () => handleSort(col.key) : undefined}
              className={`px-4 py-3 text-xs font-semibold text-secondary uppercase tracking-wide select-none
                ${idx === columns.length - 1 && !hasActions ? '' : 'border-r border-default'}
                ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'}
                ${col.sortable ? 'cursor-pointer hover:text-primary' : ''}`}
            >
              <span className="inline-flex items-center gap-1">
                {col.header}
                {col.sortable && (
                  <SortIcon size={12} className={isSorted ? 'text-brand' : 'text-disabled'} />
                )}
              </span>
            </div>
          );
        })}
        {hasActions && <div className="px-2 py-3 sticky right-0 bg-surface-subtle" />}
      </div>
      <div style={{ minWidth: 'max-content' }}>
        <List
          rowComponent={VirtualRow<T>}
          rowCount={data.length}
          rowHeight={rowHeightPx}
          rowProps={{
            data,
            columns,
            templateColumns,
            hasActions,
            renderRowActions,
            selectable,
            selectedKeys,
            toggleRow,
            getRowKey,
            onRowClick,
          }}
          defaultHeight={height}
          style={{ height }}
        />
      </div>
    </div>
  );
}
