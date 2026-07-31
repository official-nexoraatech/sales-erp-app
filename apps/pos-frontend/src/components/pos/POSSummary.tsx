interface Props {
  totalItems: number;
  totalQuantity: number;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  grandTotal: number;
  orderDiscountPct: string;
  onOrderDiscountChange: (value: string) => void;
  showDiscountInput: boolean;
}

export function POSSummary({
  totalItems,
  totalQuantity,
  subtotal,
  discountAmount,
  taxAmount,
  grandTotal,
  orderDiscountPct,
  onOrderDiscountChange,
  showDiscountInput,
}: Props) {
  return (
    <div className="space-y-2.5">
      <div className="flex justify-between text-sm text-secondary">
        <span>Total Items</span>
        <span className="tabular-nums">{totalItems}</span>
      </div>
      <div className="flex justify-between text-sm text-secondary">
        <span>Total Quantity</span>
        <span className="tabular-nums">{totalQuantity}</span>
      </div>
      <div className="flex justify-between text-sm text-secondary">
        <span>Subtotal</span>
        <span className="tabular-nums">₹{subtotal.toFixed(2)}</span>
      </div>

      {showDiscountInput && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-secondary">Order discount</span>
          <div className="flex items-center gap-1.5 text-secondary">
            <input
              type="number"
              min="0"
              max="100"
              value={orderDiscountPct}
              onChange={(e) => onOrderDiscountChange(e.target.value)}
              placeholder="0"
              aria-label="Order discount percent"
              className="w-14 rounded-md border border-default bg-surface-card px-1 text-right text-xs text-primary focus:outline-none focus:border-focus"
            />
            <span>% off all lines</span>
          </div>
        </div>
      )}
      <div className="flex justify-between text-sm text-secondary">
        <span>Discount</span>
        <span className="tabular-nums">− ₹{discountAmount.toFixed(2)}</span>
      </div>
      <div className="flex justify-between text-sm text-secondary">
        <span>Tax</span>
        <span className="tabular-nums">+ ₹{taxAmount.toFixed(2)}</span>
      </div>

      {/* role="status" (implicit aria-live="polite" + aria-atomic="true") — previously a
          screen-reader user got no announcement at all of the running total changing after
          every scan/qty edit and had to manually re-navigate to it each time. */}
      <div
        role="status"
        className="flex justify-between items-baseline text-2xl font-bold text-primary pt-1 border-t border-default"
      >
        <span className="text-base font-semibold text-secondary">Grand Total</span>
        <span>₹{grandTotal.toFixed(2)}</span>
      </div>
    </div>
  );
}
