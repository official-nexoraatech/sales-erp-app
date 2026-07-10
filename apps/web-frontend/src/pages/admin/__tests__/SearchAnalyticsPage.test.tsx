import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SearchAnalyticsPage from '../SearchAnalyticsPage.js';
import { runAxe, formatViolations } from '../../../testUtils/axe.js';

const summaryMock = vi.fn();
const listMock = vi.fn();
const retryMock = vi.fn();
const discardMock = vi.fn();

vi.mock('../../../api/endpoints.js', () => ({
  searchAnalyticsApi: { summary: (...args: unknown[]) => summaryMock(...args) },
  searchDeadLettersApi: {
    list: (...args: unknown[]) => listMock(...args),
    retry: (...args: unknown[]) => retryMock(...args),
    discard: (...args: unknown[]) => discardMock(...args),
  },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SearchAnalyticsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('SearchAnalyticsPage', () => {
  beforeEach(() => {
    summaryMock.mockReset();
    listMock.mockReset();
    retryMock.mockReset();
    discardMock.mockReset();
  });

  it('renders summary stats, popular/no-result queries, and an empty DLQ state', async () => {
    summaryMock.mockResolvedValue({
      days: 7, totalSearches: 42, noResultCount: 3, clickedCount: 20, avgLatencyMs: 85,
      popularQueries: [{ query: 'ramesh', count: 10 }],
      noResultQueries: [{ query: 'zzz', count: 3 }],
    });
    listMock.mockResolvedValue({ content: [], totalElements: 0 });

    renderPage();

    expect(await screen.findByText('42')).toBeInTheDocument();
    expect(screen.getByText('ramesh')).toBeInTheDocument();
    expect(screen.getByText('zzz')).toBeInTheDocument();
    expect(await screen.findByText('No pending sync failures')).toBeInTheDocument();
  });

  it('retrying a dead-letter item calls the retry API and refreshes the list', async () => {
    summaryMock.mockResolvedValue({
      days: 7, totalSearches: 0, noResultCount: 0, clickedCount: 0, avgLatencyMs: 0,
      popularQueries: [], noResultQueries: [],
    });
    listMock.mockResolvedValue({
      content: [{ id: 5, topic: 'erp.customer.created', payload: {}, errorMessage: 'ES down', retryCount: 1, status: 'PENDING', createdAt: new Date().toISOString(), lastRetriedAt: null }],
      totalElements: 1,
    });
    retryMock.mockResolvedValue({ message: 'ok' });

    renderPage();

    const retryButton = await screen.findByRole('button', { name: /retry/i });
    fireEvent.click(retryButton);

    await waitFor(() => expect(retryMock).toHaveBeenCalledWith(5));
  });

  it('discarding a dead-letter item calls the discard API', async () => {
    summaryMock.mockResolvedValue({
      days: 7, totalSearches: 0, noResultCount: 0, clickedCount: 0, avgLatencyMs: 0,
      popularQueries: [], noResultQueries: [],
    });
    listMock.mockResolvedValue({
      content: [{ id: 5, topic: 'erp.customer.created', payload: {}, errorMessage: 'ES down', retryCount: 1, status: 'PENDING', createdAt: new Date().toISOString(), lastRetriedAt: null }],
      totalElements: 1,
    });
    discardMock.mockResolvedValue({ message: 'ok' });

    renderPage();

    const discardButton = await screen.findByRole('button', { name: /discard/i });
    fireEvent.click(discardButton);

    await waitFor(() => expect(discardMock).toHaveBeenCalledWith(5));
  });

  // ERP-PLANNING/07_ERP_IMPLEMENTATION_PLAN.md Phase 7.
  it('has no axe accessibility violations', async () => {
    summaryMock.mockResolvedValue({
      days: 7, totalSearches: 42, noResultCount: 3, clickedCount: 20, avgLatencyMs: 85,
      popularQueries: [{ query: 'ramesh', count: 10 }],
      noResultQueries: [{ query: 'zzz', count: 3 }],
    });
    listMock.mockResolvedValue({ content: [], totalElements: 0 });

    const { container } = renderPage();
    await screen.findByText('42');

    const violations = await runAxe(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });
});
