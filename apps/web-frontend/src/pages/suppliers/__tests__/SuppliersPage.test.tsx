import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import SuppliersPage from '../SuppliersPage.js';
import { runAxe, formatViolations } from '../../../testUtils/axe.js';

vi.mock('../../../api/endpoints.js', () => ({
  supplierApi: {
    list: vi.fn().mockResolvedValue({
      content: [{ id: 1, supplierCode: 'S001', displayName: 'Fabric World', status: 'ACTIVE' }],
      totalElements: 1,
    }),
    delete: vi.fn(),
  },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SuppliersPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('SuppliersPage', () => {
  it('renders supplier rows from a mocked API response (regression for the C9 double-unwrap bug)', async () => {
    renderPage();

    expect(await screen.findByText('Fabric World')).toBeInTheDocument();
  });

  // ERP-PLANNING/07_ERP_IMPLEMENTATION_PLAN.md Phase 7.
  it('has no axe accessibility violations with data loaded', async () => {
    const { container } = renderPage();
    await screen.findByText('Fabric World');

    const violations = await runAxe(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });
});
