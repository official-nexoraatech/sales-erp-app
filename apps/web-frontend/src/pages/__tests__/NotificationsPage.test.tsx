import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import NotificationsPage from '../NotificationsPage.js';
import type * as ReactRouterDom from 'react-router-dom';
import type { InAppNotification } from '../../api/endpoints.js';

const listMock = vi.fn();
const markReadMock = vi.fn().mockResolvedValue(undefined);
const markAllReadMock = vi.fn().mockResolvedValue(undefined);
const navigateMock = vi.fn();

vi.mock('../../api/endpoints.js', () => ({
  notificationsApi: {
    list: (...args: unknown[]) => listMock(...args),
    markRead: (...args: unknown[]) => markReadMock(...args),
    markAllRead: (...args: unknown[]) => markAllReadMock(...args),
  },
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterDom>();
  return { ...actual, useNavigate: () => navigateMock };
});

function makeNotification(overrides: Partial<InAppNotification> = {}): InAppNotification {
  return {
    id: 1,
    subject: 'Invoice created',
    body: 'Invoice #INV-1 was created.',
    createdAt: new Date().toISOString(),
    readAt: null,
    entityType: 'Invoice',
    entityId: 1,
    priority: 'NORMAL',
    businessCategory: 'SALES',
    metadata: null,
    ...overrides,
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <NotificationsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('NotificationsPage', () => {
  beforeEach(() => {
    listMock.mockReset();
    markReadMock.mockReset().mockResolvedValue(undefined);
    markAllReadMock.mockReset().mockResolvedValue(undefined);
    navigateMock.mockReset();
  });

  it('shows the empty state when there are no notifications', async () => {
    listMock.mockResolvedValue({
      content: [],
      unreadCount: 0,
      page: 1,
      pageSize: 20,
      totalElements: 0,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText(/all caught up/i)).toBeInTheDocument());
  });

  it('shows a retry-able error state when the list fails to load', async () => {
    listMock.mockRejectedValue(new Error('network down'));
    renderPage();
    await waitFor(() => expect(screen.getByText(/unable to load/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('renders notifications and clicking one marks it read and navigates', async () => {
    listMock.mockResolvedValue({
      content: [makeNotification({ id: 3, entityType: 'Invoice', entityId: 5 })],
      unreadCount: 1,
      page: 1,
      pageSize: 20,
      totalElements: 1,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Invoice created')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /invoice created/i }));

    await waitFor(() => expect(markReadMock).toHaveBeenCalledWith(3));
    expect(navigateMock).toHaveBeenCalledWith('/sales/invoices/5');
  });

  it('switching to the Unread tab re-queries with unreadOnly, and marks the tab pressed', async () => {
    listMock.mockResolvedValue({
      content: [],
      unreadCount: 0,
      page: 1,
      pageSize: 20,
      totalElements: 0,
    });
    renderPage();
    await waitFor(() => expect(listMock).toHaveBeenCalled());

    const unreadTab = screen.getByRole('button', { name: 'Unread' });
    expect(unreadTab).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(unreadTab);

    await waitFor(() =>
      expect(listMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ unreadOnly: true, page: 1 })
      )
    );
    expect(unreadTab).toHaveAttribute('aria-pressed', 'true');
  });

  it('clicking a category chip re-queries with that businessCategory and marks it pressed', async () => {
    listMock.mockResolvedValue({
      content: [],
      unreadCount: 0,
      page: 1,
      pageSize: 20,
      totalElements: 0,
    });
    renderPage();
    await waitFor(() => expect(listMock).toHaveBeenCalled());

    const approvalsChip = screen.getByRole('button', { name: 'Approvals' });
    expect(approvalsChip).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(approvalsChip);

    await waitFor(() =>
      expect(listMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ businessCategory: 'APPROVAL', page: 1 })
      )
    );
    expect(approvalsChip).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'All categories' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('shows "Mark all as read" only when there are unread notifications, and calls the API on click', async () => {
    listMock.mockResolvedValue({
      content: [makeNotification({ id: 1, readAt: null })],
      unreadCount: 1,
      page: 1,
      pageSize: 20,
      totalElements: 1,
    });
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /mark all as read/i })).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole('button', { name: /mark all as read/i }));
    await waitFor(() => expect(markAllReadMock).toHaveBeenCalled());
  });

  it('does not show "Mark all as read" when unreadCount is 0', async () => {
    listMock.mockResolvedValue({
      content: [makeNotification({ id: 1, readAt: new Date().toISOString() })],
      unreadCount: 0,
      page: 1,
      pageSize: 20,
      totalElements: 1,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Invoice created')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /mark all as read/i })).not.toBeInTheDocument();
  });

  it('shows a priority pill on a HIGH-priority notification', async () => {
    listMock.mockResolvedValue({
      content: [makeNotification({ id: 1, priority: 'HIGH' })],
      unreadCount: 1,
      page: 1,
      pageSize: 20,
      totalElements: 1,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('High')).toBeInTheDocument());
  });
});
