import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { TourProvider } from '../TourProvider.js';
import { useTour } from '../useTour.js';
import { useAuthStore } from '../../../store/auth.store.js';
import type * as EndpointsModule from '../../../api/endpoints.js';

vi.mock('../../../api/endpoints.js', async (importOriginal) => {
  const actual = await importOriginal<typeof EndpointsModule>();
  return {
    ...actual,
    dapApi: {
      getProgress: vi.fn().mockResolvedValue([]),
      upsertProgress: vi.fn().mockResolvedValue({ tourId: '', status: 'in_progress' }),
      recordEvent: vi.fn().mockResolvedValue({ recorded: true }),
    },
  };
});

const FULL_PERMISSIONS = [
  'DASHBOARD_VIEW',
  'PO_VIEW',
  'GRN_CREATE',
  'ITEM_VIEW',
  'JOURNAL_VIEW',
  'GST_VIEW',
  'REPORT_VIEW',
];

function setUser(permissions: string[]) {
  useAuthStore.setState({
    user: {
      id: 1,
      tenantId: 1,
      email: 'a@test.com',
      firstName: 'A',
      lastName: 'B',
      roles: [],
      branchIds: [],
      permissions,
    },
    accessToken: 'tok',
  });
}

function Harness() {
  const { activeStep, visibleSteps, startTour, next, prev, skip } = useTour();
  const location = useLocation();
  return (
    <div>
      <div data-testid="path">{location.pathname}</div>
      <div data-testid="step">{activeStep?.id ?? 'none'}</div>
      <div data-testid="step-count">{visibleSteps.length}</div>
      <button onClick={() => startTour('purchase-to-dashboard-workflow')}>start</button>
      <button onClick={next}>next</button>
      <button onClick={prev}>prev</button>
      <button onClick={skip}>skip</button>
    </div>
  );
}

function renderHarness() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <TourProvider>
          <Harness />
        </TourProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('TourProvider / useTour', () => {
  beforeEach(() => {
    localStorage.clear();
    setUser(FULL_PERMISSIONS);
  });

  it('starts a tour and shows the first step on its declared route', () => {
    renderHarness();
    fireEvent.click(screen.getByText('start'));
    expect(screen.getByTestId('step').textContent).toBe('intro');
    expect(screen.getByTestId('path').textContent).toBe('/dashboard');
  });

  it("next() advances the step and navigates to that step's route", () => {
    renderHarness();
    fireEvent.click(screen.getByText('start'));
    fireEvent.click(screen.getByText('next'));
    expect(screen.getByTestId('step').textContent).toBe('purchase-order');
    expect(screen.getByTestId('path').textContent).toBe('/purchase/orders');
  });

  it('prev() steps back to the previous route', () => {
    renderHarness();
    fireEvent.click(screen.getByText('start'));
    fireEvent.click(screen.getByText('next'));
    fireEvent.click(screen.getByText('prev'));
    expect(screen.getByTestId('step').textContent).toBe('intro');
    expect(screen.getByTestId('path').textContent).toBe('/dashboard');
  });

  it('skip() clears the active tour', () => {
    renderHarness();
    fireEvent.click(screen.getByText('start'));
    fireEvent.click(screen.getByText('skip'));
    expect(screen.getByTestId('step').textContent).toBe('none');
  });

  it('reaching the end of the tour via next() clears the active tour', () => {
    renderHarness();
    fireEvent.click(screen.getByText('start'));
    for (let i = 0; i < 8; i++) fireEvent.click(screen.getByText('next'));
    expect(screen.getByTestId('step').textContent).toBe('none');
  });

  it('filters out steps the user lacks permission for, skipping rather than hiding the whole tour (ADR-2)', () => {
    setUser(['DASHBOARD_VIEW', 'PO_VIEW', 'GRN_CREATE', 'ITEM_VIEW']); // no JOURNAL_VIEW/GST_VIEW/REPORT_VIEW
    renderHarness();
    fireEvent.click(screen.getByText('start'));
    // 8 authored steps - 3 (accounting/gst/reports, each gated on a permission this user lacks) = 5
    expect(screen.getByTestId('step-count').textContent).toBe('5');
  });

  it('persists progress to localStorage on advance (dual-write fast path)', () => {
    renderHarness();
    fireEvent.click(screen.getByText('start'));
    fireEvent.click(screen.getByText('next'));
    const stored = JSON.parse(localStorage.getItem('erp_dap_progress') ?? '{}');
    expect(stored['purchase-to-dashboard-workflow'].currentStepId).toBe('purchase-order');
    expect(stored['purchase-to-dashboard-workflow'].status).toBe('in_progress');
  });

  it('resumes an in_progress tour from localStorage on mount', () => {
    localStorage.setItem(
      'erp_dap_progress',
      JSON.stringify({
        'purchase-to-dashboard-workflow': {
          tourVersion: 1,
          status: 'in_progress',
          currentStepId: 'stock',
        },
      })
    );
    renderHarness();
    expect(screen.getByTestId('step').textContent).toBe('stock');
    expect(screen.getByTestId('path').textContent).toBe('/inventory/stock');
  });

  it('does not resume a tour marked completed', () => {
    localStorage.setItem(
      'erp_dap_progress',
      JSON.stringify({
        'purchase-to-dashboard-workflow': {
          tourVersion: 1,
          status: 'completed',
          currentStepId: null,
        },
      })
    );
    renderHarness();
    expect(screen.getByTestId('step').textContent).toBe('none');
  });
});
