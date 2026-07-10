import { Banknote, CreditCard, QrCode, X, Plus } from 'lucide-react';
import type { Customer } from './types.js';
import { UpiQr } from './UpiQr.js';
import POSButton from './POSButton.js';

function round2(n: number) { return Math.round(n * 100) / 100; }

type PaymentMode = 'CASH' | 'CARD' | 'UPI';
interface SplitRow { mode: PaymentMode; amount: string }

const MODE_ICON: Record<PaymentMode, typeof Banknote> = { CASH: Banknote, CARD: CreditCard, UPI: QrCode };

interface Props {
  customer: Customer | null;
  redeemPoints: string;
  onRedeemPointsChange: (value: string) => void;
  splitEnabled: boolean;
  onSplitEnabledChange: (value: boolean) => void;
  splitRows: SplitRow[];
  onSplitRowsChange: (rows: SplitRow[]) => void;
  paymentMode: PaymentMode;
  onPaymentModeChange: (mode: PaymentMode) => void;
  amountTendered: string;
  onAmountTenderedChange: (value: string) => void;
  grandTotal: number;
  change: number;
  upiVpa: string | null | undefined;
  upiPayeeName: string;
  onBack: () => void;
  onCompleteSale: () => void;
  isProcessing: boolean;
}

export function POSPaymentPanel({
  customer, redeemPoints, onRedeemPointsChange,
  splitEnabled, onSplitEnabledChange, splitRows, onSplitRowsChange,
  paymentMode, onPaymentModeChange, amountTendered, onAmountTenderedChange,
  grandTotal, change, upiVpa, upiPayeeName, onBack, onCompleteSale, isProcessing,
}: Props) {
  return (
    <div className="space-y-3">
      {customer && (customer.loyaltyPoints ?? 0) > 0 && (
        <div className="flex items-center justify-between text-sm bg-warning-bg text-warning-fg rounded-xl px-3 py-2">
          <span>Redeem loyalty points ({customer.loyaltyPoints} available)</span>
          <input
            type="number"
            min="0"
            max={customer.loyaltyPoints}
            value={redeemPoints}
            onChange={(e) => onRedeemPointsChange(e.target.value)}
            placeholder="0"
            className="w-20 rounded-lg border border-default bg-surface-card px-2 py-1 text-right text-sm text-primary focus:outline-none focus:border-focus"
          />
        </div>
      )}

      <label className="flex items-center gap-2 text-sm text-primary">
        <input
          type="checkbox"
          checked={splitEnabled}
          onChange={(e) => onSplitEnabledChange(e.target.checked)}
          className="w-4 h-4 accent-[var(--brand-primary)]"
        />
        Split payment across modes
      </label>

      {splitEnabled ? (
        <div className="space-y-2">
          {splitRows.map((row, idx) => (
            <div key={idx} className="flex gap-2">
              <select
                value={row.mode}
                onChange={(e) => onSplitRowsChange(splitRows.map((r, i) => i === idx ? { ...r, mode: e.target.value as PaymentMode } : r))}
                className="rounded-lg border border-default bg-surface-card px-2 text-sm text-primary focus:outline-none focus:border-focus"
              >
                <option value="CASH">Cash</option>
                <option value="CARD">Card</option>
                <option value="UPI">UPI</option>
              </select>
              <input
                type="number"
                placeholder="Amount"
                value={row.amount}
                onChange={(e) => onSplitRowsChange(splitRows.map((r, i) => i === idx ? { ...r, amount: e.target.value } : r))}
                className="flex-1 rounded-lg border border-default bg-surface-card px-3 py-1 text-right text-primary focus:outline-none focus:border-focus"
              />
              {splitRows.length > 1 && (
                <button
                  onClick={() => onSplitRowsChange(splitRows.filter((_, i) => i !== idx))}
                  aria-label="Remove payment row"
                  className="px-2 text-secondary hover:text-primary"
                >
                  <X size={16} />
                </button>
              )}
            </div>
          ))}
          <button
            onClick={() => onSplitRowsChange([...splitRows, { mode: 'CASH', amount: '' }])}
            className="flex items-center gap-1 text-xs font-medium text-link hover:text-[var(--text-link-hover)]"
          >
            <Plus size={13} />
            Add payment mode
          </button>
          <div className="flex justify-between text-xs text-secondary">
            <span>Entered</span>
            <span>₹{splitRows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0).toFixed(2)} / ₹{round2(grandTotal - (parseFloat(redeemPoints) || 0) * 0.5).toFixed(2)}</span>
          </div>
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            {(['CASH', 'CARD', 'UPI'] as const).map((m) => {
              const Icon = MODE_ICON[m];
              return (
                <button key={m}
                  onClick={() => onPaymentModeChange(m)}
                  className={`flex-1 flex items-center justify-center gap-1.5 min-h-[44px] rounded-xl text-sm font-semibold border-2 transition-colors ${
                    paymentMode === m ? 'border-focus bg-primary-subtle text-brand' : 'border-default text-secondary hover:border-strong'
                  }`}
                >
                  <Icon size={16} />
                  {m}
                </button>
              );
            })}
          </div>
          {paymentMode === 'CASH' && (
            <>
              <input
                type="number"
                placeholder="Amount tendered"
                value={amountTendered}
                onChange={(e) => onAmountTenderedChange(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-default bg-surface-card px-3 text-lg text-right text-primary focus:outline-none focus:border-focus"
              />
              {parseFloat(amountTendered) >= grandTotal && (
                <div className="flex justify-between text-success font-semibold">
                  <span>Change</span>
                  <span>₹{change.toFixed(2)}</span>
                </div>
              )}
            </>
          )}
          {paymentMode === 'UPI' && (
            upiVpa ? (
              <div className="text-center py-2">
                <UpiQr vpa={upiVpa} payeeName={upiPayeeName} amount={grandTotal} />
                <p className="text-xs text-secondary mt-1">Scan to pay ₹{grandTotal.toFixed(2)}</p>
              </div>
            ) : (
              <p className="text-xs text-secondary text-center py-2">No UPI ID configured for this store — confirm payment manually.</p>
            )
          )}
        </>
      )}
      <div className="flex gap-2">
        <POSButton variant="secondary" size="lg" onClick={onBack} className="flex-1">
          Back
        </POSButton>
        <POSButton variant="success" size="lg" onClick={onCompleteSale} loading={isProcessing} className="flex-[2] text-lg">
          {isProcessing ? 'Processing…' : 'Complete Sale'}
        </POSButton>
      </div>
    </div>
  );
}
