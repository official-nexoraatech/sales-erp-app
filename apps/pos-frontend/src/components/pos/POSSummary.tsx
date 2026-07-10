interface Props {
  grandTotal: number;
  orderDiscountPct: string;
  onOrderDiscountChange: (value: string) => void;
  showDiscountInput: boolean;
}

export function POSSummary({ grandTotal, orderDiscountPct, onOrderDiscountChange, showDiscountInput }: Props) {
  return (
    <div className="space-y-2">
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
              className="w-14 rounded-md border border-default bg-surface-card px-1 text-right text-xs text-primary focus:outline-none focus:border-focus"
            />
            <span>% off all lines</span>
          </div>
        </div>
      )}
      <div className="flex justify-between items-baseline text-2xl font-bold text-primary">
        <span className="text-base font-semibold text-secondary">Total</span>
        <span>₹{grandTotal.toFixed(2)}</span>
      </div>
    </div>
  );
}
