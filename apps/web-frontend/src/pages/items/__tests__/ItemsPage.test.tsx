import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import ItemsPage from '../ItemsPage.js';
import { runAxe, formatViolations } from '../../../testUtils/axe.js';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ItemsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

vi.mock('../../../api/endpoints.js', () => ({
  itemApi: {
    list: vi.fn().mockResolvedValue({
      content: [{ id: 1, itemCode: 'I001', name: 'Cotton Shirt', status: 'ACTIVE' }],
      totalElements: 1,
    }),
    delete: vi.fn(),
    generateBarcode: vi.fn(),
  },
  categoryApi: { list: vi.fn().mockResolvedValue({ content: [] }) },
  brandApi: { list: vi.fn().mockResolvedValue({ content: [] }) },
}));

describe('ItemsPage', () => {
  it('renders item rows from a mocked API response (regression for the C9 double-unwrap bug)', async () => {
    renderPage();

    expect(await screen.findByText('Cotton Shirt')).toBeInTheDocument();
  });

  // ERP-PLANNING/07_ERP_IMPLEMENTATION_PLAN.md Phase 7.
  it('has no axe accessibility violations with data loaded', async () => {
    const { container } = renderPage();
    await screen.findByText('Cotton Shirt');

    const violations = await runAxe(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });
});
