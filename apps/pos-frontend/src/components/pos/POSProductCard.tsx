import type { POSItem } from './types.js';

export function POSProductCard({
  item,
  onSelect,
}: {
  item: POSItem;
  onSelect: (item: POSItem) => void;
}) {
  return (
    <button
      onClick={() => onSelect(item)}
      className="flex flex-col justify-between min-h-[88px] bg-surface-card rounded-xl border-2 border-default p-3 text-center hover:border-focus hover:shadow-token-sm active:scale-95 transition-all"
    >
      <div className="text-sm font-semibold text-primary truncate">{item.name}</div>
      <div className="flex items-baseline justify-center gap-1.5 mt-1">
        <span className="text-lg font-bold text-primary">
          ₹{parseFloat(item.salePrice ?? '0').toFixed(2)}
        </span>
        {item.mrp != null && item.mrp > parseFloat(item.salePrice ?? '0') && (
          <span className="text-xs text-secondary line-through">₹{item.mrp.toFixed(2)}</span>
        )}
      </div>
    </button>
  );
}
