/**
 * OFFLINE-07 testing requirement #2 ("The client correctly routes a STOCK_CONFLICT stuck
 * item to the resolution UI, showing accurate available/requested figures") had no
 * component-level test — only the underlying markStockConflict/resolveConflict logic
 * (offlineDb.test.ts) was covered. StockConflictModal is exported from POSScreen.tsx
 * specifically so this UI can be tested without mounting the full POS screen.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { db } from '../db.js';
import type { PendingSale } from '../db.js';
import { StockConflictModal } from '../POSScreen.js';
import { runAxe, formatViolations } from '../testUtils/axe.js';

function conflictSale(overrides: Partial<PendingSale> = {}): PendingSale {
  return {
    id: 1,
    payload: { lines: [{ itemId: 42, quantity: 5 }] },
    operationId: 'op-1',
    createdAt: Date.now(),
    retries: 5,
    status: 'stuck',
    conflict: { itemId: 42, available: 2, requested: 5 },
    ...overrides,
  };
}

beforeEach(async () => {
  await db.catalogItems.clear();
});

describe('StockConflictModal', () => {
  it('shows a "No stock conflicts" message when there are none', async () => {
    await act(async () => {
      render(<StockConflictModal conflicts={[]} onResolve={vi.fn()} onClose={vi.fn()} />);
      await new Promise((r) => setTimeout(r, 0)); // flush the empty-conflicts effect's Promise.all([]) resolution
    });
    expect(screen.getByText('No stock conflicts')).toBeInTheDocument();
  });

  it('shows the correct queued vs. available figures, falling back to "Item #id" if uncached', async () => {
    render(<StockConflictModal conflicts={[conflictSale()]} onResolve={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText('Item #42')).toBeInTheDocument();
    expect(screen.getByText(/Queued: 5/)).toBeInTheDocument();
    expect(screen.getByText(/Available now: 2/)).toBeInTheDocument();
  });

  it('resolves the item name from the local catalog cache when available', async () => {
    await db.catalogItems.put({
      id: 42, tenantId: 1, name: 'Amul Milk 1L', hsnCode: '0401', gstRate: 5, cessRate: 0,
      salePrice: 60, unitId: 1, status: 'ACTIVE', updatedAt: new Date().toISOString(),
    });
    render(<StockConflictModal conflicts={[conflictSale()]} onResolve={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText('Amul Milk 1L')).toBeInTheDocument();
  });

  it('calls onResolve with "adjust" when "Adjust & retry" is clicked', async () => {
    const onResolve = vi.fn();
    render(<StockConflictModal conflicts={[conflictSale()]} onResolve={onResolve} onClose={vi.fn()} />);
    await screen.findByText('Item #42');
    fireEvent.click(screen.getByText(/Adjust to 2 & retry/));
    expect(onResolve).toHaveBeenCalledWith(1, 'adjust');
  });

  it('calls onResolve with "cancel" when "Cancel sale" is clicked', async () => {
    const onResolve = vi.fn();
    render(<StockConflictModal conflicts={[conflictSale()]} onResolve={onResolve} onClose={vi.fn()} />);
    await screen.findByText('Item #42');
    fireEvent.click(screen.getByText('Cancel sale'));
    expect(onResolve).toHaveBeenCalledWith(1, 'cancel');
  });

  it('renders one row per distinct conflicting sale, each with its own figures', async () => {
    const sales = [
      conflictSale({ id: 1, conflict: { itemId: 42, available: 2, requested: 5 } }),
      conflictSale({ id: 2, conflict: { itemId: 43, available: 0, requested: 1 } }),
    ];
    render(<StockConflictModal conflicts={sales} onResolve={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText('Item #42')).toBeInTheDocument();
    expect(await screen.findByText('Item #43')).toBeInTheDocument();
    expect(screen.getByText(/Available now: 0/)).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn();
    await act(async () => {
      render(<StockConflictModal conflicts={[]} onResolve={vi.fn()} onClose={onClose} />);
      await new Promise((r) => setTimeout(r, 0)); // flush the empty-conflicts effect's Promise.all([]) resolution
    });
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ERP-PLANNING/07_ERP_IMPLEMENTATION_PLAN.md Phase 7.
  it('has no axe accessibility violations with a conflict shown', async () => {
    const { container } = render(<StockConflictModal conflicts={[conflictSale()]} onResolve={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText('Item #42');

    const violations = await runAxe(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });
});
