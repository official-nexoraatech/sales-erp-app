import { Banknote, CreditCard, QrCode, X, Plus } from 'lucide-react';
import type { Customer } from './types.js';
import { UpiQr } from './UpiQr.js';
import POSButton from './POSButton.js';

// Matches apps/sales-service/src/domain/LoyaltyService.ts's DEFAULT_REDEEM_RATE exactly —
// this is the one place in this file that used to hardcode it; POSScreen.tsx now imports
// this constant too instead of carrying a second, independently-drifting copy.
export const LOYALTY_POINT_VALUE = 0.5;

type PaymentMode = 'CASH' | 'CARD' | 'UPI';
interface SplitRow {
  mode: PaymentMode;
  amount: string;
}

const MODE_ICON: Record<PaymentMode, typeof Banknote> = {
  CASH: Banknote,
  CARD: CreditCard,
  UPI: QrCode,
};

interface RewardCatalogItem {
  id: number;
  name: string;
  pointsCost: number;
  rewardType: 'DISCOUNT_AMOUNT' | 'DISCOUNT_PERCENT';
  rewardValue: string;
}

interface Props {
  customer: Customer | null;
  redeemPoints: string;
  onRedeemPointsChange: (value: string) => void;
  /** CRM-ROADMAP Phase 2, Feature 3 — specific rewards, mutually exclusive with the raw
   * points input above (selecting one clears/disables the other in this panel). */
  rewardCatalog: RewardCatalogItem[];
  selectedRewardId: string;
  onSelectedRewardIdChange: (value: string) => void;
  splitEnabled: boolean;
  onSplitEnabledChange: (value: boolean) => void;
  splitRows: SplitRow[];
  onSplitRowsChange: (rows: SplitRow[]) => void;
  paymentMode: PaymentMode;
  onPaymentModeChange: (mode: PaymentMode) => void;
  amountTendered: string;
  onAmountTenderedChange: (value: string) => void;
  /** grandTotal minus the value of any redeemed loyalty points — the amount actually owed
   * in cash/card/UPI, matching pos.routes.ts's server-authoritative `amountDue`. */
  amountDue: number;
  change: number;
  upiVpa: string | null | undefined;
  upiPayeeName: string;
  onBack: () => void;
  onCompleteSale: () => void;
  isProcessing: boolean;
}

export function POSPaymentPanel({
  customer,
  redeemPoints,
  onRedeemPointsChange,
  rewardCatalog,
  selectedRewardId,
  onSelectedRewardIdChange,
  splitEnabled,
  onSplitEnabledChange,
  splitRows,
  onSplitRowsChange,
  paymentMode,
  onPaymentModeChange,
  amountTendered,
  onAmountTenderedChange,
  amountDue,
  change,
  upiVpa,
  upiPayeeName,
  onBack,
  onCompleteSale,
  isProcessing,
}: Props) {
  const affordableRewards = rewardCatalog.filter(
    (r) => r.pointsCost <= (customer?.loyaltyPoints ?? 0)
  );
  // pos.routes.ts rejects a split sale whose payment rows don't sum to amountDue with a
  // post-hoc PAYMENT_MISMATCH — previously the only feedback the cashier ever got was that
  // server rejection *after* a full round trip. Mirror the same 0.02 tolerance here so a
  // mismatched split can't even be submitted.
  const splitEntered = splitRows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  const splitMismatch = splitEnabled && Math.abs(splitEntered - amountDue) > 0.02;

  return (
    <div className="space-y-3">
      {customer && (customer.loyaltyPoints ?? 0) > 0 && (
        <div className="space-y-2 bg-warning-bg text-warning-fg rounded-xl px-3 py-2">
          {affordableRewards.length > 0 && (
            <div className="flex items-center justify-between text-sm gap-2">
              <span>Redeem a reward</span>
              <select
                value={selectedRewardId}
                onChange={(e) => {
                  onSelectedRewardIdChange(e.target.value);
                  if (e.target.value) onRedeemPointsChange('');
                }}
                className="flex-1 max-w-[60%] rounded-lg border border-default bg-surface-card px-2 py-1 text-sm text-primary focus:outline-none focus:border-focus"
              >
                <option value="">None</option>
                {affordableRewards.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} — {r.pointsCost} pts
                  </option>
                ))}
              </select>
            </div>
          )}
          {!selectedRewardId && (
            <div className="flex items-center justify-between text-sm">
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
                onChange={(e) =>
                  onSplitRowsChange(
                    splitRows.map((r, i) =>
                      i === idx ? { ...r, mode: e.target.value as PaymentMode } : r
                    )
                  )
                }
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
                onChange={(e) =>
                  onSplitRowsChange(
                    splitRows.map((r, i) => (i === idx ? { ...r, amount: e.target.value } : r))
                  )
                }
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
          <div
            className={`flex justify-between text-xs font-medium ${splitMismatch ? 'text-danger' : 'text-success'}`}
          >
            <span>Entered</span>
            <span>
              ₹{splitEntered.toFixed(2)} / ₹{amountDue.toFixed(2)}
            </span>
          </div>
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            {(['CASH', 'CARD', 'UPI'] as const).map((m) => {
              const Icon = MODE_ICON[m];
              return (
                <button
                  key={m}
                  onClick={() => onPaymentModeChange(m)}
                  className={`flex-1 flex items-center justify-center gap-1.5 min-h-[44px] rounded-xl text-sm font-semibold border-2 transition-colors ${
                    paymentMode === m
                      ? 'border-focus bg-primary-subtle text-brand'
                      : 'border-default text-secondary hover:border-strong'
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
              {parseFloat(amountTendered) >= amountDue && (
                <div className="flex justify-between text-success font-semibold">
                  <span>Change</span>
                  <span>₹{change.toFixed(2)}</span>
                </div>
              )}
            </>
          )}
          {paymentMode === 'UPI' &&
            (upiVpa ? (
              <div className="text-center py-2">
                <UpiQr vpa={upiVpa} payeeName={upiPayeeName} amount={amountDue} />
                <p className="text-xs text-secondary mt-1">Scan to pay ₹{amountDue.toFixed(2)}</p>
              </div>
            ) : (
              <p className="text-xs text-secondary text-center py-2">
                No UPI ID configured for this store — confirm payment manually.
              </p>
            ))}
        </>
      )}
      <div className="flex gap-2">
        <POSButton variant="secondary" size="lg" onClick={onBack} className="flex-1">
          Back
        </POSButton>
        <POSButton
          variant="success"
          size="lg"
          onClick={onCompleteSale}
          loading={isProcessing}
          disabled={splitMismatch}
          className="flex-[2] text-lg"
        >
          {isProcessing ? 'Processing…' : 'Complete Sale'}
        </POSButton>
      </div>
    </div>
  );
}
