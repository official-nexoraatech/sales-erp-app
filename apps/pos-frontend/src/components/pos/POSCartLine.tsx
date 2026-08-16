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
      className={`flex items-center gap-4 rounded-xl p-4 transition-colors ${
        highlighted ? 'bg-primary-subtle ring-2 ring-focus' : 'bg-surface-subtle'
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-primary break-words">{line.itemName}</div>
        <div className="text-xs text-secondary flex items-center gap-1 mt-1">
          <span>
            ₹{line.unitPrice.toFixed(2)}
            {line.mrp !== null && line.mrp > line.unitPrice && (
              <span className="line-through ml-1">₹{line.mrp.toFixed(2)}</span>
            )}{' '}
            × {line.quantity}
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
            aria-label={`Discount percent for ${line.itemName}`}
            className="w-10 rounded-md border border-default bg-surface-card px-1 text-xs text-primary focus:outline-none focus:border-focus"
          />
          <span>% off</span>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => onUpdateQty(line.itemId, round2(line.quantity - 1))}
          aria-label="Decrease quantity"
          className="flex items-center justify-center w-11 h-11 rounded-lg bg-surface-raised hover:bg-surface-sunken text-primary transition-colors"
        >
          <Minus size={18} />
        </button>
        <input
          type="number"
          min="0"
          step="1"
          value={line.quantity}
          onChange={(e) => onUpdateQty(line.itemId, parseFloat(e.target.value) || 0)}
          title="Quantity (supports fractional, e.g. 2.5 metres — type it directly)"
          aria-label={`Quantity for ${line.itemName}`}
          className="w-16 h-11 text-center text-base font-semibold rounded-lg border border-default bg-surface-card text-primary focus:outline-none focus:border-focus"
        />
        <button
          onClick={() => onUpdateQty(line.itemId, round2(line.quantity + 1))}
          aria-label="Increase quantity"
          className="flex items-center justify-center w-11 h-11 rounded-lg bg-surface-raised hover:bg-surface-sunken text-primary transition-colors"
        >
          <Plus size={18} />
        </button>
      </div>
      <div className="text-sm font-semibold text-primary w-24 text-right shrink-0">
        ₹{line.lineTotal.toFixed(2)}
      </div>
    </div>
  );
}
