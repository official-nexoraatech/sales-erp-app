/**
 * PG-051 — BranchSelectScreen. Follows ShiftOpenScreen.test.tsx's render+MemoryRouter
 * convention and auth.test.ts's fakeJwt helper for exercising getAuthClaims()-driven
 * branch scoping. Navigation is asserted via a real <Routes> so "persists and moves on"
 * is verified end-to-end rather than just checking localStorage.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { setTokens } from '../auth.js';
import { getSelectedBranch } from '../branchStore.js';
import BranchSelectScreen from '../BranchSelectScreen.js';
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

function renderBranchSelect() {
  return render(
    <MemoryRouter initialEntries={['/branch-select']}>
      <Routes>
        <Route path="/branch-select" element={<BranchSelectScreen />} />
        <Route path="/" element={<div>Home Screen</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('BranchSelectScreen', () => {
  it('auto-skips straight through (no picker rendered) when the caller has exactly one branch and warehouse', async () => {
    setTokens(fakeJwt({ tenantId: 1, branchIds: [1] }), 'refresh-1');
    const fetchMock = vi.fn((url: string) => {
      const u = String(url);
      if (u.includes('/branches'))
        return Promise.resolve(jsonResponse(200, { data: { content: [{ id: 1, name: 'HQ' }] } }));
      if (u.includes('/warehouses'))
        return Promise.resolve(
          jsonResponse(200, { data: { content: [{ id: 10, name: 'Main WH', branchId: 1 }] } })
        );
      return Promise.resolve(jsonResponse(200, { data: { content: [] } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderBranchSelect();

    await screen.findByText('Home Screen');
    expect(screen.queryByText('Select Branch')).not.toBeInTheDocument();
    expect(getSelectedBranch()).toEqual({ branchId: 1, warehouseId: 10 });
  });

  it('renders a branch picker when the caller has access to more than one branch', async () => {
    setTokens(fakeJwt({ tenantId: 1, branchIds: [1, 2] }), 'refresh-1');
    const fetchMock = vi.fn((url: string) => {
      const u = String(url);
      if (u.includes('/branches')) {
        return Promise.resolve(
          jsonResponse(200, {
            data: {
              content: [
                { id: 1, name: 'HQ' },
                { id: 2, name: 'Branch 2' },
              ],
            },
          })
        );
      }
      if (u.includes('/warehouses'))
        return Promise.resolve(
          jsonResponse(200, { data: { content: [{ id: 10, name: 'Main WH', branchId: 1 }] } })
        );
      return Promise.resolve(jsonResponse(200, { data: { content: [] } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderBranchSelect();

    expect(await screen.findByText('Select Branch')).toBeInTheDocument();
    expect(screen.getByText('HQ')).toBeInTheDocument();
    expect(screen.getByText('Branch 2')).toBeInTheDocument();
  });

  it('only offers branches the caller is scoped to, filtering the full branch list down to branchIds', async () => {
    setTokens(fakeJwt({ tenantId: 1, branchIds: [1, 2] }), 'refresh-1');
    const fetchMock = vi.fn((url: string) => {
      const u = String(url);
      if (u.includes('/branches')) {
        return Promise.resolve(
          jsonResponse(200, {
            data: {
              content: [
                { id: 1, name: 'HQ' },
                { id: 2, name: 'Branch 2' },
                { id: 3, name: 'Branch 3 (no access)' },
              ],
            },
          })
        );
      }
      if (u.includes('/warehouses'))
        return Promise.resolve(
          jsonResponse(200, { data: { content: [{ id: 10, name: 'Main WH', branchId: 1 }] } })
        );
      return Promise.resolve(jsonResponse(200, { data: { content: [] } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderBranchSelect();

    await screen.findByText('Select Branch');
    expect(screen.queryByText('Branch 3 (no access)')).not.toBeInTheDocument();
  });

  it('persists the selected branch and warehouse and navigates on after a branch is chosen', async () => {
    setTokens(fakeJwt({ tenantId: 1, branchIds: [1, 2] }), 'refresh-1');
    const fetchMock = vi.fn((url: string) => {
      const u = String(url);
      if (u.includes('/branches')) {
        return Promise.resolve(
          jsonResponse(200, {
            data: {
              content: [
                { id: 1, name: 'HQ' },
                { id: 2, name: 'Branch 2' },
              ],
            },
          })
        );
      }
      if (u.includes('/warehouses?branchId=2'))
        return Promise.resolve(
          jsonResponse(200, { data: { content: [{ id: 20, name: 'B2 WH', branchId: 2 }] } })
        );
      return Promise.resolve(jsonResponse(200, { data: { content: [] } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderBranchSelect();

    fireEvent.click(await screen.findByText('Branch 2'));

    await screen.findByText('Home Screen');
    expect(getSelectedBranch()).toEqual({ branchId: 2, warehouseId: 20 });
  });

  it('shows a warehouse sub-picker only when the selected branch has more than one warehouse', async () => {
    setTokens(fakeJwt({ tenantId: 1, branchIds: [1] }), 'refresh-1');
    const fetchMock = vi.fn((url: string) => {
      const u = String(url);
      if (u.includes('/branches'))
        return Promise.resolve(jsonResponse(200, { data: { content: [{ id: 1, name: 'HQ' }] } }));
      if (u.includes('/warehouses')) {
        return Promise.resolve(
          jsonResponse(200, {
            data: {
              content: [
                { id: 10, name: 'Front WH', branchId: 1 },
                { id: 11, name: 'Back WH', branchId: 1 },
              ],
            },
          })
        );
      }
      return Promise.resolve(jsonResponse(200, { data: { content: [] } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderBranchSelect();

    expect(await screen.findByText('Select Warehouse')).toBeInTheDocument();
    expect(screen.getByText('Front WH')).toBeInTheDocument();
    expect(screen.getByText('Back WH')).toBeInTheDocument();
  });

  it('falls back to manual warehouse entry when GET /warehouses is forbidden (WAREHOUSE_VIEW not held)', async () => {
    setTokens(fakeJwt({ tenantId: 1, branchIds: [1] }), 'refresh-1');
    const fetchMock = vi.fn((url: string) => {
      const u = String(url);
      if (u.includes('/branches'))
        return Promise.resolve(jsonResponse(200, { data: { content: [{ id: 1, name: 'HQ' }] } }));
      if (u.includes('/warehouses'))
        return Promise.resolve(jsonResponse(403, { error: { code: 'FORBIDDEN' } }));
      return Promise.resolve(jsonResponse(200, { data: { content: [] } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderBranchSelect();

    const manualInput = await screen.findByLabelText(/Warehouse ID/);
    fireEvent.change(manualInput, { target: { value: '99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await screen.findByText('Home Screen');
    expect(getSelectedBranch()).toEqual({ branchId: 1, warehouseId: 99 });
  });

  it('has no axe accessibility violations while the branch picker is shown', async () => {
    setTokens(fakeJwt({ tenantId: 1, branchIds: [1, 2] }), 'refresh-1');
    const fetchMock = vi.fn((url: string) => {
      const u = String(url);
      if (u.includes('/branches')) {
        return Promise.resolve(
          jsonResponse(200, {
            data: {
              content: [
                { id: 1, name: 'HQ' },
                { id: 2, name: 'Branch 2' },
              ],
            },
          })
        );
      }
      return Promise.resolve(jsonResponse(200, { data: { content: [] } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container } = renderBranchSelect();
    await screen.findByText('Select Branch');

    const violations = await runAxe(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });
});
