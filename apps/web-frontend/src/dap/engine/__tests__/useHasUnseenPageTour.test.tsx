import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { TourProvider } from '../TourProvider.js';
import { useHasUnseenPageTour } from '../useHasUnseenPageTour.js';
import { useAuthStore } from '../../../store/auth.store.js';
import type * as EndpointsModule from '../../../api/endpoints.js';

const mockGetProgress = vi.fn();
vi.mock('../../../api/endpoints.js', async (importOriginal) => {
  const actual = await importOriginal<typeof EndpointsModule>();
  return {
    ...actual,
    dapApi: {
      getProgress: () => mockGetProgress(),
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

function Probe() {
  const hasUnseen = useHasUnseenPageTour();
  return <span data-testid="probe">{String(hasUnseen)}</span>;
}

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <TourProvider>
          <Probe />
        </TourProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('useHasUnseenPageTour', () => {
  beforeEach(() => {
    mockGetProgress.mockReset();
    setUser(['DASHBOARD_VIEW']);
  });

  it('is true on a page with an available, never-touched tour', async () => {
    mockGetProgress.mockResolvedValue([]);
    renderAt('/dashboard');
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('true'));
  });

  it("is false once the page's tour has any progress record (started, skipped, or completed)", async () => {
    mockGetProgress.mockResolvedValue([
      { tourId: 'dashboard-overview', tourVersion: 1, status: 'skipped', currentStepId: null },
    ]);
    renderAt('/dashboard');
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('false'));
  });

  it('is false on a page with no matching tour at all', async () => {
    mockGetProgress.mockResolvedValue([]);
    renderAt('/some-page-with-no-tour');
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('false'));
  });

  it('is false when the user lacks the permission the page tour requires', async () => {
    setUser([]);
    mockGetProgress.mockResolvedValue([]);
    renderAt('/dashboard');
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('false'));
  });
});
