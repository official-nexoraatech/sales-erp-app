import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReceiptOverlay } from '../components/pos/ReceiptOverlay.js';
import type { CompletedSale } from '../components/pos/types.js';

function deleteNavProp(name: 'usb' | 'serial') {
  delete (navigator as unknown as Record<string, unknown>)[name];
}

afterEach(() => {
  deleteNavProp('usb');
  deleteNavProp('serial');
});

const sale: CompletedSale = {
  invoiceId: 1,
  invoiceNumber: 'INV-001',
  grandTotal: 118,
  lines: [
    {
      itemId: 1,
      itemName: 'Widget',
      quantity: 2,
      unitPrice: 50,
      gstRate: 18,
      discountPct: 0,
      lineTotal: 118,
    },
  ],
  customer: null,
  paymentMode: 'CASH',
  amountTendered: 118,
  change: 0,
  synced: true,
};

describe('ReceiptOverlay hardware-print feature-detection', () => {
  it('hides the connected-printer button when neither WebUSB nor Web Serial exist, e.g. Safari/iOS', () => {
    render(<ReceiptOverlay sale={sale} onClose={() => {}} />);
    expect(screen.queryByText('Print via connected printer')).not.toBeInTheDocument();
    // the existing window.print() fallback remains present and unaffected
    expect(screen.getByText('Print Receipt')).toBeInTheDocument();
  });

  it('shows the connected-printer button when WebUSB is available and paper size is thermal (80mm default)', () => {
    (navigator as unknown as Record<string, unknown>)['usb'] = {};
    render(<ReceiptOverlay sale={sale} onClose={() => {}} />);
    expect(screen.getByText('Print via connected printer')).toBeInTheDocument();
    expect(screen.getByText('Print Receipt')).toBeInTheDocument();
  });
});
