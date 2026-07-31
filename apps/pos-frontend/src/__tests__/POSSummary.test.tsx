/**
 * The running grand total previously had no aria-live region at all — a screen-reader
 * cashier got no announcement of the total changing after every scan/qty edit. No dedicated
 * test existed for this component before.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { POSSummary } from '../components/pos/POSSummary.js';
import { runAxe, formatViolations } from '../testUtils/axe.js';

const BASE_PROPS = {
  totalItems: 2,
  totalQuantity: 3,
  subtotal: 200,
  discountAmount: 0,
  taxAmount: 36,
  orderDiscountPct: '',
  onOrderDiscountChange: vi.fn(),
  showDiscountInput: false,
};

describe('POSSummary', () => {
  it('exposes the grand total in a role="status" live region', () => {
    render(<POSSummary {...BASE_PROPS} grandTotal={236} />);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('₹236.00');
  });

  it('shows the full totals breakdown', () => {
    render(<POSSummary {...BASE_PROPS} grandTotal={236} discountAmount={10} />);

    expect(screen.getByText('Total Items')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Total Quantity')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Subtotal')).toBeInTheDocument();
    expect(screen.getByText('₹200.00')).toBeInTheDocument();
    expect(screen.getByText('Discount')).toBeInTheDocument();
    expect(screen.getByText('− ₹10.00')).toBeInTheDocument();
    expect(screen.getByText('Tax')).toBeInTheDocument();
    expect(screen.getByText('+ ₹36.00')).toBeInTheDocument();
  });

  it('has no axe accessibility violations', async () => {
    const { container } = render(
      <POSSummary {...BASE_PROPS} grandTotal={236} showDiscountInput={true} />
    );
    const violations = await runAxe(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });
});
