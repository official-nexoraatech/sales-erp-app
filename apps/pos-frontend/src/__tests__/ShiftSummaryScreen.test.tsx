/**
 * PG-050 — ShiftSummaryScreen.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ShiftSummaryScreen from '../ShiftSummaryScreen.js';
import type { PosSession } from '../session.js';
import { runAxe, formatViolations } from '../testUtils/axe.js';

const CLOSED_SESSION: PosSession = {
  id: 55,
  sessionNumber: 'POS-1-55',
  branchId: 1,
  warehouseId: 10,
  status: 'CLOSED',
  openingCash: '2000.00',
  closingCash: '2300.00',
  expectedCash: '2350.00',
  cashVariance: '-50.00',
  totalSales: '350.00',
  totalTransactions: 3,
  openedAt: '2026-07-11T08:00:00.000Z',
  closedAt: '2026-07-11T17:00:00.000Z',
};

beforeEach(() => {
  vi.restoreAllMocks();
});

function renderSummary(session: PosSession | null) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/shift/summary', state: { session } }]}>
      <Routes>
        <Route path="/shift/summary" element={<ShiftSummaryScreen />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ShiftSummaryScreen', () => {
  it('renders the passed-through session recap, including the computed cash variance', () => {
    renderSummary(CLOSED_SESSION);

    expect(screen.getByText('POS-1-55')).toBeInTheDocument();
    expect(screen.getByText('₹350.00')).toBeInTheDocument(); // total sales
    expect(screen.getByText('₹-50.00')).toBeInTheDocument(); // cash variance
  });

  it('shows a fallback message instead of crashing when no session state was passed', () => {
    renderSummary(null);
    expect(screen.getByText(/summary is unavailable/i)).toBeInTheDocument();
  });

  it('has no axe accessibility violations', async () => {
    const { container } = renderSummary(CLOSED_SESSION);
    const violations = await runAxe(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });
});
