import { List, type RowComponentProps } from 'react-window';
import POSBadge from './POSBadge.js';
import type { POSSearchResult } from './types.js';

export const ROW_HEIGHT = 52;
const MAX_VISIBLE_ROWS = 8;

interface RowProps {
  results: POSSearchResult[];
  highlightedIndex: number;
  onSelect: (item: POSSearchResult) => void;
  onHover: (index: number) => void;
}

function stockBadge(qty: number | null) {
  if (qty === null) return <POSBadge variant="info">Stock unknown</POSBadge>;
  if (qty <= 0) return <POSBadge variant="danger">Out of stock</POSBadge>;
  if (qty <= 5) return <POSBadge variant="warning">{qty} left</POSBadge>;
  return <POSBadge variant="success">In stock</POSBadge>;
}

function POSResultRow({
  index,
  style,
  results,
  highlightedIndex,
  onSelect,
  onHover,
}: RowComponentProps<RowProps>) {
  const item = results[index]!;
  const highlighted = index === highlightedIndex;
  const code = item.sku ?? item.barcode ?? item.supplierCode ?? item.customCode;
  return (
    <div
      style={style}
      role="option"
      id={`pos-result-${item.itemId}`}
      aria-selected={highlighted}
      onMouseEnter={() => onHover(index)}
      onMouseDown={(e) => {
        e.preventDefault();
        onSelect(item);
      }}
      className={`flex items-center justify-between gap-3 px-4 cursor-pointer border-b border-default last:border-b-0 ${
        highlighted ? 'bg-primary-subtle' : 'bg-surface-card hover:bg-surface-raised'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-primary truncate">{item.name}</div>
        {code && (
          <div className="text-xs text-secondary truncate">
            {item.matchedOn === 'alias' && item.alias ? `Alias: ${item.alias}` : code}
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {stockBadge(item.stock.qty)}
        <span className="text-sm font-semibold text-primary tabular-nums">
          ₹{item.price.toFixed(2)}
          {item.mrp !== null && item.mrp > item.price && (
            <span className="ml-1.5 text-xs font-normal text-secondary line-through tabular-nums">
              ₹{item.mrp.toFixed(2)}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

interface Props {
  results: POSSearchResult[];
  highlightedIndex: number;
  onSelect: (item: POSSearchResult) => void;
  onHover: (index: number) => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  /** Full-screen lookup modal (Phase 3): fills its flex container instead of capping at
   * MAX_VISIBLE_ROWS the way the omnibox's popup dropdown does. */
  fill?: boolean;
  listboxId?: string;
}

export default function POSAutocompleteList({
  results,
  highlightedIndex,
  onSelect,
  onHover,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  fill,
  listboxId = 'pos-omnibox-listbox',
}: Props) {
  const height = Math.min(results.length, MAX_VISIBLE_ROWS) * ROW_HEIGHT;
  return (
    <div
      role="listbox"
      id={listboxId}
      aria-label="Item search results"
      className={fill ? 'h-full' : undefined}
      style={fill ? undefined : { height }}
    >
      <List
        rowComponent={POSResultRow}
        rowCount={results.length}
        rowHeight={ROW_HEIGHT}
        rowProps={{ results, highlightedIndex, onSelect, onHover }}
        onRowsRendered={({ stopIndex }) => {
          if (hasNextPage && !isFetchingNextPage && stopIndex >= results.length - 3) {
            onLoadMore();
          }
        }}
      />
    </div>
  );
}
