import { describe, it, expect } from 'vitest';
import { buildReceipt, buildDrawerKickOnly, cmdCut, cmdDrawerKick } from '../escpos.js';
import type { CompletedSale } from '../components/pos/types.js';

const decoder = new TextDecoder();

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

describe('escpos byte builder', () => {
  it('includes an item line with quantity and price', () => {
    const bytes = buildReceipt(sale);
    const text = decoder.decode(bytes);
    expect(text).toContain('Widget x2');
    expect(text).toContain('Rs.118.00');
  });

  it('includes the totals line', () => {
    const bytes = buildReceipt(sale);
    const text = decoder.decode(bytes);
    expect(text).toContain('Total');
    expect(text).toContain('Rs.118.00');
    expect(text).toContain('Paid via CASH');
  });

  it('includes a change line only when change is positive', () => {
    const withChange = buildReceipt({ ...sale, amountTendered: 150, change: 32 });
    expect(decoder.decode(withChange)).toContain('Change');

    const withoutChange = buildReceipt(sale);
    expect(decoder.decode(withoutChange)).not.toContain('Change');
  });

  it('ends with the paper-cut command', () => {
    const bytes = buildReceipt(sale);
    const cut = cmdCut();
    expect(Array.from(bytes.slice(-cut.length))).toEqual(cut);
  });

  it('appends the drawer-kick command before the cut when requested', () => {
    const withKick = buildReceipt(sale, { drawerKick: true });
    const withoutKick = buildReceipt(sale, { drawerKick: false });
    const kick = cmdDrawerKick();
    expect(Array.from(withKick.slice(-kick.length - cmdCut().length, -cmdCut().length))).toEqual(
      kick
    );
    expect(withKick.length).toBe(withoutKick.length + kick.length);
  });

  it('produces just the drawer-kick command for a standalone open-drawer action', () => {
    expect(Array.from(buildDrawerKickOnly())).toEqual(cmdDrawerKick());
  });

  it('respects the paper-width column setting', () => {
    const narrow = buildReceipt(sale, { paperWidthChars: 32 });
    const wide = buildReceipt(sale, { paperWidthChars: 42 });
    const narrowLine = decoder
      .decode(narrow)
      .split('\n')
      .find((l) => l.includes('Widget'))!;
    const wideLine = decoder
      .decode(wide)
      .split('\n')
      .find((l) => l.includes('Widget'))!;
    expect(narrowLine.length).toBeLessThan(wideLine.length);
  });
});
