/**
 * PG-050 — ShiftCloseScreen.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setActiveSessionId, getActiveSessionId } from '../session.js';
import ShiftCloseScreen from '../ShiftCloseScreen.js';
import { runAxe, formatViolations } from '../testUtils/axe.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const SUMMARY_ROW = {
  id: 55,
  sessionNumber: 'POS-1-55',
  branchId: 1,
  warehouseId: 10,
  status: 'OPEN',
  openingCash: '2000.00',
  closingCash: null,
  expectedCash: null,
  cashVariance: null,
  totalSales: '350.00',
  totalTransactions: 3,
  openedAt: new Date().toISOString(),
  closedAt: null,
};

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  setActiveSessionId(55);
});

function renderShiftClose() {
  return render(
    <MemoryRouter>
      <ShiftCloseScreen />
    </MemoryRouter>
  );
}

describe('ShiftCloseScreen', () => {
  it('shows the running expected cash from the session summary before closing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { data: SUMMARY_ROW })));

    renderShiftClose();

    expect(await screen.findByText('₹2350.00')).toBeInTheDocument(); // openingCash + totalSales
  });

  it('submits closing cash and clears the persisted session id on success', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/close') && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse(200, { data: { expectedCash: 2350, cashVariance: -50 } })
        );
      }
      if (u.includes('/summary')) {
        return Promise.resolve(
          jsonResponse(200, {
            data: {
              ...SUMMARY_ROW,
              status: 'CLOSED',
              closingCash: '2300.00',
              expectedCash: '2350.00',
              cashVariance: '-50.00',
              closedAt: new Date().toISOString(),
            },
          })
        );
      }
      return Promise.resolve(jsonResponse(200, { data: null }));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderShiftClose();

    const input = await screen.findByLabelText(/Closing Cash Counted/);
    fireEvent.change(input, { target: { value: '2300' } });
    fireEvent.click(screen.getByText('Close Shift'));

    await waitFor(() => {
      const closeCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/close'));
      expect(closeCall).toBeDefined();
    });
    const closeCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/close'))!;
    expect(JSON.parse((closeCall[1] as RequestInit).body as string)).toEqual({ closingCash: 2300 });

    await waitFor(() => expect(getActiveSessionId()).toBeNull());
  });

  it('has no axe accessibility violations', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { data: SUMMARY_ROW })));
    const { container } = renderShiftClose();
    await screen.findByLabelText(/Closing Cash Counted/);

    const violations = await runAxe(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });
});
