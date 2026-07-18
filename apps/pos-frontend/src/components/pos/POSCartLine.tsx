import { Minus, Plus } from 'lucide-react';
import type { CartItem } from './types.js';

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

interface Props {
  line: CartItem;
  onUpdateQty: (itemId: number, qty: number) => void;
  onUpdateDiscount: (itemId: number, discountPct: number) => void;
  /** Arrow-key cart navigation (F5/6/7/Ctrl+D keyboard map) highlights one line at a time. */
  highlighted?: boolean;
}

export function POSCartLine({ line, onUpdateQty, onUpdateDiscount, highlighted }: Props) {
  return (
    <div
      className={`flex items-center gap-2 rounded-xl p-2.5 transition-colors ${
        highlighted ? 'bg-primary-subtle ring-2 ring-focus' : 'bg-surface-subtle'
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-primary truncate">{line.itemName}</div>
        <div className="text-xs text-secondary flex items-center gap-1 mt-0.5">
          <span>
            ₹{line.unitPrice.toFixed(2)} × {line.quantity}
          </span>
          <input
            id={`pos-cart-discount-${line.itemId}`}
            type="number"
            min="0"
            max="100"
            value={line.discountPct || ''}
            onChange={(e) => onUpdateDiscount(line.itemId, parseFloat(e.target.value) || 0)}
            placeholder="0"
            title="Discount %"
            className="w-10 rounded-md border border-default bg-surface-card px-1 text-xs text-primary focus:outline-none focus:border-focus"
          />
          <span>% off</span>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => onUpdateQty(line.itemId, round2(line.quantity - 1))}
          aria-label="Decrease quantity"
          className="flex items-center justify-center w-9 h-9 rounded-lg bg-surface-raised hover:bg-surface-sunken text-primary transition-colors"
        >
          <Minus size={15} />
        </button>
        <input
          type="number"
          min="0"
          step="1"
          value={line.quantity}
          onChange={(e) => onUpdateQty(line.itemId, parseFloat(e.target.value) || 0)}
          title="Quantity (supports fractional, e.g. 2.5 metres — type it directly)"
          className="w-14 h-9 text-center text-sm font-semibold rounded-lg border border-default bg-surface-card text-primary focus:outline-none focus:border-focus"
        />
        <button
          onClick={() => onUpdateQty(line.itemId, round2(line.quantity + 1))}
          aria-label="Increase quantity"
          className="flex items-center justify-center w-9 h-9 rounded-lg bg-surface-raised hover:bg-surface-sunken text-primary transition-colors"
        >
          <Plus size={15} />
        </button>
      </div>
      <div className="text-sm font-semibold text-primary w-20 text-right shrink-0">
        ₹{line.lineTotal.toFixed(2)}
      </div>
    </div>
  );
}
