/**
 * The qty/discount inputs previously only had `title=` (a mouse-hover tooltip, inconsistently
 * exposed as an accessible name by assistive tech) rather than `aria-label` — effectively
 * unlabeled to a screen reader. No dedicated test existed for this component at all.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { POSCartLine } from '../components/pos/POSCartLine.js';
import { runAxe, formatViolations } from '../testUtils/axe.js';
import type { CartItem } from '../components/pos/types.js';

const LINE: CartItem = {
  itemId: 1,
  itemName: 'Cotton Poplin',
  quantity: 2,
  unitPrice: 100,
  mrp: null,
  gstRate: 18,
  cessRate: 0,
  discountPct: 0,
  lineTotal: 236,
};

describe('POSCartLine', () => {
  it('exposes an accessible name for the quantity and discount inputs, distinguishing them by item name', () => {
    render(<POSCartLine line={LINE} onUpdateQty={vi.fn()} onUpdateDiscount={vi.fn()} />);

    expect(screen.getByLabelText('Quantity for Cotton Poplin')).toBeInTheDocument();
    expect(screen.getByLabelText('Discount percent for Cotton Poplin')).toBeInTheDocument();
  });

  it('has no axe accessibility violations', async () => {
    const { container } = render(
      <POSCartLine line={LINE} onUpdateQty={vi.fn()} onUpdateDiscount={vi.fn()} />
    );
    const violations = await runAxe(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });

  // Multi-vertical platform audit 2026-08-16, Phase 2: MRP existed on items but was never
  // carried into the cart — a near-universal Indian retail/grocery display expectation.
  it('shows a struck-through MRP next to the sale price when the item has one above the sale price', () => {
    render(
      <POSCartLine line={{ ...LINE, mrp: 150 }} onUpdateQty={vi.fn()} onUpdateDiscount={vi.fn()} />
    );
    expect(screen.getByText('₹150.00')).toBeInTheDocument();
  });

  it('does not show an MRP when the item has none set', () => {
    render(<POSCartLine line={LINE} onUpdateQty={vi.fn()} onUpdateDiscount={vi.fn()} />);
    expect(screen.queryByText(/₹\d+\.\d+.*₹\d+\.\d+/)).not.toBeInTheDocument();
  });
});
