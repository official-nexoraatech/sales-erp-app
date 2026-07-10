import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ERPCommandPalette from '../ERPCommandPalette.js';
import { useRecentSearchesStore } from '../../../store/recentSearches.store.js';
import { runAxe, formatViolations } from '../../../testUtils/axe.js';

const searchMock = vi.fn();
const navigateMock = vi.fn();
const savedSearchListMock = vi.fn().mockResolvedValue({ content: [], totalElements: 0 });

vi.mock('../../../api/endpoints.js', () => ({
  searchApi: { search: (...args: unknown[]) => searchMock(...args) },
  savedSearchApi: {
    list: (...args: unknown[]) => savedSearchListMock(...args),
    create: vi.fn(),
    delete: vi.fn(),
  },
  searchAnalyticsApi: {
    trackClick: vi.fn().mockResolvedValue(undefined),
    summary: vi.fn(),
  },
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});

function renderPalette(open = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const { container } = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ERPCommandPalette open={open} onClose={onClose} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { onClose, container };
}

describe('ERPCommandPalette', () => {
  beforeEach(() => {
    searchMock.mockReset();
    navigateMock.mockReset();
    savedSearchListMock.mockReset().mockResolvedValue({ content: [], totalElements: 0 });
    useRecentSearchesStore.setState({ items: [] });
  });

  it('renders nothing when closed', () => {
    renderPalette(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a hint and no API call when the query is empty and there are no recent searches', () => {
    renderPalette();
    expect(screen.getByText(/start typing to search/i)).toBeInTheDocument();
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('debounces typing, then shows grouped results with highlighted matches', async () => {
    searchMock.mockResolvedValue({
      hits: [
        {
          id: '7', entity: 'customer', score: 1,
          highlight: { name: ['<em>Ramesh</em> Textiles'] },
          source: { name: 'Ramesh Textiles', phone: '9999999999' },
        },
      ],
      total: 1, took: 5, query: 'ramesh',
    });

    renderPalette();
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'ramesh' } });

    await waitFor(() => expect(searchMock).toHaveBeenCalledWith({ q: 'ramesh', size: 30 }));
    expect(await screen.findByText('Customers')).toBeInTheDocument();
    expect(screen.getByText('Ramesh')).toBeInTheDocument(); // the <em> portion, rendered via <mark>
    expect(screen.getByText('Textiles')).toBeInTheDocument();
  });

  it('shows the no-results state for a query with zero hits', async () => {
    searchMock.mockResolvedValue({ hits: [], total: 0, took: 2, query: 'zzz' });

    renderPalette();
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'zzz' } });

    expect(await screen.findByText(/no results found/i)).toBeInTheDocument();
  });

  it('Enter navigates to the highlighted result, closes the palette, and records it as a recent search', async () => {
    searchMock.mockResolvedValue({
      hits: [{ id: '7', entity: 'customer', score: 1, source: { name: 'Ramesh Textiles' } }],
      total: 1, took: 1, query: 'ramesh',
    });

    const { onClose } = renderPalette();
    const input = screen.getByLabelText('Search');
    fireEvent.change(input, { target: { value: 'ramesh' } });
    await screen.findByText('Ramesh Textiles');

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });

    expect(navigateMock).toHaveBeenCalledWith('/customers/7');
    expect(onClose).toHaveBeenCalled();
    expect(useRecentSearchesStore.getState().items[0]).toMatchObject({ id: '7', entity: 'customer', label: 'Ramesh Textiles' });
  });

  it('Escape closes the palette without navigating', async () => {
    const { onClose } = renderPalette();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('a result with no mapped route renders as non-navigable and does nothing on Enter', async () => {
    searchMock.mockResolvedValue({
      hits: [{ id: '3', entity: 'journal_entry', score: 1, source: { description: 'Manual JE' } }],
      total: 1, took: 1, query: 'manual',
    });

    const { onClose } = renderPalette();
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'manual' } });
    await screen.findByText('Manual JE');

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });

    expect(navigateMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('opening the filters panel and setting a status re-queries with that status', async () => {
    searchMock.mockResolvedValue({ hits: [], total: 0, took: 1, query: 'inv' });

    renderPalette();
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'inv' } });
    await waitFor(() => expect(searchMock).toHaveBeenCalled());

    fireEvent.click(screen.getByLabelText('Toggle advanced filters'));
    fireEvent.change(screen.getByPlaceholderText('e.g. ACTIVE'), { target: { value: 'OVERDUE' } });

    await waitFor(() =>
      expect(searchMock).toHaveBeenCalledWith(expect.objectContaining({ q: 'inv', status: 'OVERDUE' }))
    );
  });

  it('shows saved searches above recent searches when the query is empty, and clicking one re-runs it', async () => {
    savedSearchListMock.mockResolvedValue({
      content: [{ id: 1, tenantId: 1, userId: 1, name: 'Overdue invoices', query: 'overdue', entity: null, filters: {}, createdAt: '2026-01-01' }],
      totalElements: 1,
    });

    renderPalette();

    expect(await screen.findByText('Saved Searches')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Overdue invoices'));

    expect(screen.getByLabelText('Search')).toHaveValue('overdue');
  });

  // ERP-PLANNING/07_ERP_IMPLEMENTATION_PLAN.md Phase 7.
  it('has no axe accessibility violations with results shown', async () => {
    searchMock.mockResolvedValue({
      hits: [{ id: '7', entity: 'customer', score: 1, source: { name: 'Ramesh Textiles' } }],
      total: 1, took: 1, query: 'ramesh',
    });

    const { container } = renderPalette();
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'ramesh' } });
    await screen.findByText('Ramesh Textiles');

    const violations = await runAxe(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });
});
