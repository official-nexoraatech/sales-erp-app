import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { TourProvider } from '../../../dap/engine/TourProvider.js';
import { TourGuidePanel } from '../TourGuidePanel.js';
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

function renderPanel(path: string, onClose = vi.fn(), onOpenHelp = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <TourProvider>
          <TourGuidePanel onClose={onClose} onOpenHelp={onOpenHelp} />
        </TourProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('TourGuidePanel', () => {
  beforeEach(() => {
    setUser(['DASHBOARD_VIEW', 'PO_VIEW', 'GRN_CREATE', 'ITEM_VIEW']);
  });

  it('lists the current page\'s available tour under "This page"', () => {
    renderPanel('/dashboard');
    expect(screen.getByText('This page')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Start guided tour: Dashboard/i })
    ).toBeInTheDocument();
  });

  it('lists cross-module tours under "Business workflows"', () => {
    renderPanel('/dashboard');
    expect(screen.getByText('Business workflows')).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: /Start guided tour: Purchase → Dashboard/i,
      })
    ).toBeInTheDocument();
  });

  it('shows no "This page" section on a page with no matching tour, while Business workflows still lists cross-module tours', () => {
    // Cross-module tours declare no `requiredPermissions` (gating happens per-step once
    // running instead) and aren't tied to any one page — so "Business workflows" is never
    // actually empty in this app's real content, and the empty state below is reachable only
    // in principle (e.g. a future tenant with zero tours registered at all), not via
    // permissions or route alone. Assert what's actually true instead.
    renderPanel('/some-page-with-no-tour');
    expect(screen.queryByText('This page')).not.toBeInTheDocument();
    expect(screen.getByText('Business workflows')).toBeInTheDocument();
  });

  it('clicking a tour closes the panel', () => {
    const onClose = vi.fn();
    renderPanel('/dashboard', onClose);
    fireEvent.click(screen.getByRole('button', { name: /Start guided tour: Dashboard/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape closes the panel', () => {
    const onClose = vi.fn();
    renderPanel('/dashboard', onClose);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('"Open Help Center" closes this panel and opens Help', () => {
    const onClose = vi.fn();
    const onOpenHelp = vi.fn();
    renderPanel('/dashboard', onClose, onOpenHelp);
    fireEvent.click(screen.getByRole('button', { name: 'Open Help Center' }));
    expect(onClose).toHaveBeenCalled();
    expect(onOpenHelp).toHaveBeenCalled();
  });
});
