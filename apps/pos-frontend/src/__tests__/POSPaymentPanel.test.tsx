/**
 * POSPaymentPanel.tsx previously computed Change, the CASH change-row gate, the UPI QR
 * amount, and split payment's "Required" figure inconsistently: the split view alone
 * subtracted the redeemed loyalty-points value from grandTotal, while Change/UPI/gate used
 * the raw grandTotal. A customer who redeemed points and paid the remainder in cash saw the
 * wrong Change; UPI QR encoded the pre-redemption total. This fixes all four to agree on
 * `amountDue` (grandTotal minus redemption value), matching pos.routes.ts's
 * server-authoritative `amountDue = grandTotal - redemptionValue`.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { POSPaymentPanel } from '../components/pos/POSPaymentPanel.js';

const noop = () => {};

describe('POSPaymentPanel', () => {
  it('shows Change and gates its display against amountDue, not the pre-redemption grandTotal', () => {
    // grandTotal 100, 100 points redeemed (₹50 value) => amountDue 50; tendering exactly 50
    // should show ₹0 change, not stay hidden because 50 < grandTotal(100).
    render(
      <POSPaymentPanel
        customer={null}
        redeemPoints="100"
        onRedeemPointsChange={noop}
        rewardCatalog={[]}
        selectedRewardId=""
        onSelectedRewardIdChange={noop}
        splitEnabled={false}
        onSplitEnabledChange={noop}
        splitRows={[{ mode: 'CASH', amount: '' }]}
        onSplitRowsChange={noop}
        paymentMode="CASH"
        onPaymentModeChange={noop}
        amountTendered="50"
        onAmountTenderedChange={noop}
        amountDue={50}
        change={0}
        upiVpa={null}
        upiPayeeName="Store"
        onBack={noop}
        onCompleteSale={noop}
        isProcessing={false}
      />
    );

    expect(screen.getByText('Change')).toBeInTheDocument();
    expect(screen.getByText('₹0.00')).toBeInTheDocument();
  });

  it('does not show Change while tendered is still below amountDue, even if above grandTotal minus a stale figure', () => {
    render(
      <POSPaymentPanel
        customer={null}
        redeemPoints="0"
        onRedeemPointsChange={noop}
        rewardCatalog={[]}
        selectedRewardId=""
        onSelectedRewardIdChange={noop}
        splitEnabled={false}
        onSplitEnabledChange={noop}
        splitRows={[{ mode: 'CASH', amount: '' }]}
        onSplitRowsChange={noop}
        paymentMode="CASH"
        onPaymentModeChange={noop}
        amountTendered="40"
        onAmountTenderedChange={noop}
        amountDue={100}
        change={0}
        upiVpa={null}
        upiPayeeName="Store"
        onBack={noop}
        onCompleteSale={noop}
        isProcessing={false}
      />
    );

    expect(screen.queryByText('Change')).not.toBeInTheDocument();
  });

  it('shows the split-payment "Required" figure as amountDue', () => {
    render(
      <POSPaymentPanel
        customer={null}
        redeemPoints="100"
        onRedeemPointsChange={noop}
        rewardCatalog={[]}
        selectedRewardId=""
        onSelectedRewardIdChange={noop}
        splitEnabled={true}
        onSplitEnabledChange={noop}
        splitRows={[{ mode: 'CASH', amount: '20' }]}
        onSplitRowsChange={noop}
        paymentMode="CASH"
        onPaymentModeChange={noop}
        amountTendered=""
        onAmountTenderedChange={noop}
        amountDue={50}
        change={0}
        upiVpa={null}
        upiPayeeName="Store"
        onBack={noop}
        onCompleteSale={noop}
        isProcessing={false}
      />
    );

    expect(screen.getByText('₹20.00 / ₹50.00')).toBeInTheDocument();
  });

  it('disables Complete Sale when split-payment rows do not sum to amountDue', () => {
    render(
      <POSPaymentPanel
        customer={null}
        redeemPoints="0"
        onRedeemPointsChange={noop}
        rewardCatalog={[]}
        selectedRewardId=""
        onSelectedRewardIdChange={noop}
        splitEnabled={true}
        onSplitEnabledChange={noop}
        splitRows={[{ mode: 'CASH', amount: '30' }]}
        onSplitRowsChange={noop}
        paymentMode="CASH"
        onPaymentModeChange={noop}
        amountTendered=""
        onAmountTenderedChange={noop}
        amountDue={100}
        change={0}
        upiVpa={null}
        upiPayeeName="Store"
        onBack={noop}
        onCompleteSale={noop}
        isProcessing={false}
      />
    );

    expect(screen.getByText('Complete Sale')).toBeDisabled();
    expect(screen.getByText('₹30.00 / ₹100.00')).toBeInTheDocument();
  });

  it('enables Complete Sale once split-payment rows sum to amountDue (within the 0.02 tolerance)', () => {
    render(
      <POSPaymentPanel
        customer={null}
        redeemPoints="0"
        onRedeemPointsChange={noop}
        rewardCatalog={[]}
        selectedRewardId=""
        onSelectedRewardIdChange={noop}
        splitEnabled={true}
        onSplitEnabledChange={noop}
        splitRows={[
          { mode: 'CASH', amount: '60' },
          { mode: 'UPI', amount: '40' },
        ]}
        onSplitRowsChange={noop}
        paymentMode="CASH"
        onPaymentModeChange={noop}
        amountTendered=""
        onAmountTenderedChange={noop}
        amountDue={100}
        change={0}
        upiVpa={null}
        upiPayeeName="Store"
        onBack={noop}
        onCompleteSale={noop}
        isProcessing={false}
      />
    );

    expect(screen.getByText('Complete Sale')).not.toBeDisabled();
  });

  it('shows the UPI "Scan to pay" amount as amountDue, not the pre-redemption grandTotal', async () => {
    render(
      <POSPaymentPanel
        customer={null}
        redeemPoints="100"
        onRedeemPointsChange={noop}
        rewardCatalog={[]}
        selectedRewardId=""
        onSelectedRewardIdChange={noop}
        splitEnabled={false}
        onSplitEnabledChange={noop}
        splitRows={[{ mode: 'CASH', amount: '' }]}
        onSplitRowsChange={noop}
        paymentMode="UPI"
        onPaymentModeChange={noop}
        amountTendered=""
        onAmountTenderedChange={noop}
        amountDue={50}
        change={0}
        upiVpa="store@upi"
        upiPayeeName="Store"
        onBack={noop}
        onCompleteSale={noop}
        isProcessing={false}
      />
    );

    expect(await screen.findByText('Scan to pay ₹50.00')).toBeInTheDocument();
  });
});
