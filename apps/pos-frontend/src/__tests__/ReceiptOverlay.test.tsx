/**
 * ReceiptOverlay is the one modal-like surface in this app not built on POSDialog (it needs
 * its own always-black-on-white print styling), and previously had no focus trap, no Escape
 * handler, and no dialog role/aria-modal at all — despite being the very last screen a cashier
 * sees on every single completed sale. This adds the same behavior POSDialog already provides
 * everywhere else, verified here at the component level (no dedicated test existed before).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReceiptOverlay } from '../components/pos/ReceiptOverlay.js';
import { runAxe, formatViolations } from '../testUtils/axe.js';
import type { CompletedSale } from '../components/pos/types.js';

const SALE: CompletedSale = {
  invoiceId: 1,
  invoiceNumber: 'POS-1-123',
  grandTotal: 118,
  lines: [
    {
      itemId: 1,
      itemName: 'Widget',
      quantity: 2,
      unitPrice: 50,
      mrp: null,
      gstRate: 18,
      cessRate: 0,
      discountPct: 0,
      lineTotal: 118,
    },
  ],
  customer: null,
  paymentMode: 'CASH',
  amountTendered: 120,
  change: 2,
  synced: true,
};

describe('ReceiptOverlay', () => {
  it('exposes dialog semantics (role, aria-modal, labelled by the Receipt heading)', () => {
    render(<ReceiptOverlay sale={SALE} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Receipt');
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<ReceiptOverlay sale={SALE} onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('traps Tab focus within the panel (Shift+Tab from the first element wraps to the last)', () => {
    render(<ReceiptOverlay sale={SALE} onClose={vi.fn()} />);
    const closeButton = screen.getByLabelText('Close receipt');
    const newSaleButton = screen.getByText('New Sale');

    expect(document.activeElement).toBe(closeButton);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(newSaleButton);
  });

  it('has no axe accessibility violations', async () => {
    const { container } = render(<ReceiptOverlay sale={SALE} onClose={vi.fn()} />);
    const violations = await runAxe(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });
});
