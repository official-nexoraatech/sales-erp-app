import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runAxe, formatViolations } from '../../../testUtils/axe.js';
import CustomersPage from '../CustomersPage.js';
import { useAuthStore } from '../../../store/auth.store.js';

const listMock = vi.fn();

vi.mock('../../../api/endpoints.js', () => ({
  customerApi: {
    list: (...args: unknown[]) => listMock(...args),
    delete: vi.fn(),
  },
}));

// Exposes the current URL search string so tests can assert on it — ERP-PLANNING/
// 02_ERP_NAVIGATION_ARCHITECTURE.md §17's URL-synced-filters requirement.
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

function renderPage(initialEntries = ['/customers']) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={initialEntries}>
        <CustomersPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const SAMPLE_ROWS = {
  content: [
    {
      id: 1,
      customerCode: 'C001',
      displayName: 'Acme Textiles',
      customerType: 'RETAIL',
      status: 'ACTIVE',
    },
  ],
  totalElements: 1,
  page: 0,
  size: 50,
};

describe('CustomersPage', () => {
  beforeEach(() => {
    listMock.mockReset();
    useAuthStore.setState({ user: null });
  });

  // ES-35 — CUSTOMER_DELETE existed on the backend (and was already correctly enforced
  // there) but was missing from the frontend's permission constants, so this Delete
  // action rendered unconditionally for every logged-in user regardless of permission.
  // Row actions render as standalone icon buttons (ERPDataGrid's `actions` prop) rather
  // than behind a "More actions" dropdown, so these assertions look for bare buttons.
  it('hides Edit/Delete/New Customer actions when the user lacks the corresponding permissions', async () => {
    listMock.mockResolvedValue(SAMPLE_ROWS);

    renderPage();

    expect(await screen.findByText('Acme Textiles')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ New Customer' })).not.toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('shows Edit/Delete/New Customer actions when the user holds the permissions', async () => {
    useAuthStore.setState({
      user: {
        id: 1,
        tenantId: 1,
        email: 't@test.com',
        firstName: 'T',
        lastName: 'U',
        roles: ['ADMIN'],
        branchIds: [],
        permissions: ['CUSTOMER_EDIT', 'CUSTOMER_DELETE', 'CUSTOMER_CREATE'],
      },
    });
    listMock.mockResolvedValue(SAMPLE_ROWS);

    renderPage();

    expect(await screen.findByText('Acme Textiles')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ New Customer' })).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('renders customer rows from a mocked API response (regression for the C9 double-unwrap bug)', async () => {
    // apiClient.get() already strips one ".data" envelope level, so customerApi.list()
    // resolves directly to { content, totalElements, page, size } — not { data: { content... } }.
    listMock.mockResolvedValue({
      content: [
        {
          id: 1,
          customerCode: 'C001',
          displayName: 'Acme Textiles',
          customerType: 'RETAIL',
          status: 'ACTIVE',
        },
      ],
      totalElements: 1,
      page: 0,
      size: 50,
    });

    renderPage();

    expect(await screen.findByText('Acme Textiles')).toBeInTheDocument();
  });

  it('renders the error empty-state, not the "no data" empty-state, when the query fails', async () => {
    listMock.mockRejectedValue(new Error('Network error'));

    renderPage();

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    expect(screen.queryByText('No records yet')).not.toBeInTheDocument();
  });

  // ERP-PLANNING/07_ERP_IMPLEMENTATION_PLAN.md Phase 7 — axe-core smoke check on a real,
  // data-loaded list page (the highest-traffic pattern: ERPPageHeader + ERPDataGrid +
  // icon-button row actions).
  it('has no axe accessibility violations with data loaded', async () => {
    listMock.mockResolvedValue(SAMPLE_ROWS);

    const { container } = renderPage();
    await screen.findByText('Acme Textiles');

    const violations = await runAxe(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });

  // ERP-PLANNING/02_ERP_NAVIGATION_ARCHITECTURE.md §17 — filters must be reflected in the
  // URL so back/forward and shared links restore the view, not reset it.
  it('reflects a typed search into the URL after the debounce settles', async () => {
    listMock.mockResolvedValue(SAMPLE_ROWS);
    renderPage();

    fireEvent.change(screen.getByPlaceholderText('Search name, phone, GSTIN…'), {
      target: { value: 'ramesh' },
    });

    // 250ms debounce + a re-render cycle — give it real margin rather than waitFor's 1000ms
    // default, since this environment's per-test overhead (axe/CSS parsing in prior tests)
    // has shown real wall-clock variance.
    await waitFor(
      () => expect(screen.getByTestId('location-search')).toHaveTextContent('q=ramesh'),
      { timeout: 3000 }
    );
  });

  it('restores search/status filters from the URL on initial load (deep link)', async () => {
    listMock.mockResolvedValue(SAMPLE_ROWS);
    renderPage(['/customers?q=ramesh&status=ACTIVE']);

    expect(screen.getByPlaceholderText('Search name, phone, GSTIN…')).toHaveValue('ramesh');
    expect(screen.getByLabelText('Filter by status')).toHaveValue('ACTIVE');
    await waitFor(() =>
      expect(listMock).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'ramesh', status: 'ACTIVE' })
      )
    );
  });

  it('omits filter params from the URL once they are cleared back to the default', async () => {
    listMock.mockResolvedValue(SAMPLE_ROWS);
    renderPage(['/customers?status=ACTIVE']);
    expect(screen.getByTestId('location-search')).toHaveTextContent('status=ACTIVE');

    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: '' } });

    await waitFor(() => expect(screen.getByTestId('location-search')).toHaveTextContent(''));
  });
});
