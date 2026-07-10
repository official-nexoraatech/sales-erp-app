import { ShoppingCart } from 'lucide-react';
import type { CartItem } from './types.js';
import { POSCartLine } from './POSCartLine.js';

interface Props {
  items: CartItem[];
  onUpdateQty: (itemId: number, qty: number) => void;
  onUpdateDiscount: (itemId: number, discountPct: number) => void;
}

export function POSCart({ items, onUpdateQty, onUpdateDiscount }: Props) {
  if (items.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-disabled">
        <ShoppingCart size={32} strokeWidth={1.5} />
        <p className="text-sm">Cart is empty</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-2">
      {items.map((line) => (
        <POSCartLine key={line.itemId} line={line} onUpdateQty={onUpdateQty} onUpdateDiscount={onUpdateDiscount} />
      ))}
    </div>
  );
}
