import type { POSItem } from './types.js';

export function POSProductCard({ item, onSelect }: { item: POSItem; onSelect: (item: POSItem) => void }) {
  return (
    <button
      onClick={() => onSelect(item)}
      className="flex flex-col justify-between min-h-[88px] bg-surface-card rounded-xl border-2 border-default p-3 text-center hover:border-focus hover:shadow-token-sm active:scale-95 transition-all"
    >
      <div className="text-sm font-semibold text-primary truncate">{item.name}</div>
      <div className="text-lg font-bold text-primary mt-1">₹{parseFloat(item.salePrice ?? '0').toFixed(2)}</div>
    </button>
  );
}
