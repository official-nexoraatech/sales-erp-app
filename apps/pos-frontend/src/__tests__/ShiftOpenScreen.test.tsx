/**
 * PG-050/PG-051 — ShiftOpenScreen. Branch/warehouse resolution moved to BranchSelectScreen
 * (PG-051); this screen now just reads branchStore's persisted selection (mirroring
 * LookupScreen.test.tsx's render+MemoryRouter convention and auth.test.ts's fakeJwt helper).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setTokens } from '../auth.js';
import { getActiveSessionId } from '../session.js';
import { setSelectedBranch } from '../branchStore.js';
import ShiftOpenScreen from '../ShiftOpenScreen.js';
import { runAxe, formatViolations } from '../testUtils/axe.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fakeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'RS256' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.fake-signature`;
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

function renderShiftOpen() {
  return render(
    <MemoryRouter>
      <ShiftOpenScreen />
    </MemoryRouter>
  );
}

describe('ShiftOpenScreen', () => {
  it('submits opening cash using the branch/warehouse persisted by BranchSelectScreen', async () => {
    setTokens(fakeJwt({ tenantId: 1, branchIds: [1] }), 'refresh-1');
    setSelectedBranch(1, 10);
    let openBody: Record<string, unknown> | null = null;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/pos/sessions/open') && init?.method === 'POST') {
        openBody = JSON.parse((init.body as string) ?? '{}');
        return Promise.resolve(jsonResponse(201, { data: { id: 55, sessionNumber: 'POS-1-55' } }));
      }
      return Promise.resolve(jsonResponse(200, { data: [] }));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderShiftOpen();

    const openingCashInput = await screen.findByLabelText(/Opening Cash/);
    fireEvent.change(openingCashInput, { target: { value: '2000' } });

    const submitButton = screen.getByRole('button', { name: 'Open Shift' });
    await waitFor(() => expect(submitButton).not.toBeDisabled());
    fireEvent.click(submitButton);

    await waitFor(() => expect(openBody).not.toBeNull());
    expect(openBody).toEqual({ branchId: 1, warehouseId: 10, openingCash: 2000 });
    expect(getActiveSessionId()).toBe(55);
  });

  it('disables submission when no branch/warehouse has been persisted', async () => {
    setTokens(fakeJwt({ tenantId: 1, branchIds: [1] }), 'refresh-1');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { data: [] })));

    renderShiftOpen();

    const openingCashInput = await screen.findByLabelText(/Opening Cash/);
    fireEvent.change(openingCashInput, { target: { value: '2000' } });

    const submitButton = screen.getByRole('button', { name: 'Open Shift' });
    expect(submitButton).toBeDisabled();
  });

  it('has no axe accessibility violations', async () => {
    setTokens(fakeJwt({ tenantId: 1, branchIds: [1] }), 'refresh-1');
    setSelectedBranch(1, 10);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { data: [] })));

    const { container } = renderShiftOpen();
    await screen.findByLabelText(/Opening Cash/);

    const violations = await runAxe(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });
});
