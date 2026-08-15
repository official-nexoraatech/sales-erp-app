import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationsPanel } from '../NotificationsPanel.js';
import type * as ReactRouterDom from 'react-router-dom';
import type { InAppNotification } from '../../../api/endpoints.js';

const listMock = vi.fn();
const markReadMock = vi.fn().mockResolvedValue(undefined);
const markAllReadMock = vi.fn().mockResolvedValue(undefined);
const approveMock = vi.fn().mockResolvedValue(undefined);
const navigateMock = vi.fn();

vi.mock('../../../api/endpoints.js', () => ({
  notificationsApi: {
    list: (...args: unknown[]) => listMock(...args),
    markRead: (...args: unknown[]) => markReadMock(...args),
    markAllRead: (...args: unknown[]) => markAllReadMock(...args),
  },
  approvalApi: {
    approve: (...args: unknown[]) => approveMock(...args),
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

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const onUnreadCountChange = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <NotificationsPanel onClose={onClose} onUnreadCountChange={onUnreadCountChange} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { onClose, onUnreadCountChange };
}

describe('NotificationsPanel', () => {
  beforeEach(() => {
    listMock.mockReset();
    markReadMock.mockReset().mockResolvedValue(undefined);
    markAllReadMock.mockReset().mockResolvedValue(undefined);
    approveMock.mockReset().mockResolvedValue(undefined);
    navigateMock.mockReset();
  });

  it('shows a loading state, then the empty state when there are no notifications', async () => {
    listMock.mockResolvedValue({
      content: [],
      unreadCount: 0,
      page: 1,
      pageSize: 10,
      totalElements: 0,
    });
    renderPanel();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/all caught up/i)).toBeInTheDocument());
  });

  it('shows a retry-able error state when the list fails to load', async () => {
    listMock.mockRejectedValue(new Error('network down'));
    renderPanel();
    await waitFor(() => expect(screen.getByText(/unable to load/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('renders unread notifications with a distinct indicator', async () => {
    listMock.mockResolvedValue({
      content: [
        makeNotification({ id: 1, readAt: null }),
        makeNotification({ id: 2, readAt: new Date().toISOString() }),
      ],
      unreadCount: 1,
      page: 1,
      pageSize: 10,
      totalElements: 2,
    });
    renderPanel();
    await waitFor(() => expect(screen.getAllByText('Invoice created')).toHaveLength(2));
    const rows = screen.getAllByRole('button', { name: /invoice created/i });
    expect(rows).toHaveLength(2);
  });

  it('clicking a resolvable notification marks it read and navigates to its route', async () => {
    listMock.mockResolvedValue({
      content: [makeNotification({ id: 5, entityType: 'Invoice', entityId: 42, readAt: null })],
      unreadCount: 1,
      page: 1,
      pageSize: 10,
      totalElements: 1,
    });
    const { onClose } = renderPanel();
    await waitFor(() => expect(screen.getByText('Invoice created')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /invoice created/i }));

    await waitFor(() => expect(markReadMock).toHaveBeenCalledWith(5));
    expect(navigateMock).toHaveBeenCalledWith('/sales/invoices/42');
    expect(onClose).toHaveBeenCalled();
  });

  it('clicking a notification with no resolvable route does not navigate or throw', async () => {
    listMock.mockResolvedValue({
      content: [makeNotification({ id: 6, entityType: 'Expense', entityId: 1, readAt: null })],
      unreadCount: 1,
      page: 1,
      pageSize: 10,
      totalElements: 1,
    });
    const { onClose } = renderPanel();
    await waitFor(() => expect(screen.getByText('Invoice created')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /invoice created/i }));

    await waitFor(() => expect(markReadMock).toHaveBeenCalledWith(6));
    expect(navigateMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('an APPROVAL notification routes to My Approvals with its instanceId, regardless of entityType', async () => {
    listMock.mockResolvedValue({
      content: [
        makeNotification({
          id: 7,
          businessCategory: 'APPROVAL',
          entityType: 'PurchaseOrder',
          entityId: 9,
          readAt: null,
          metadata: { instanceId: 100, nodeId: 'node_1' },
        }),
      ],
      unreadCount: 1,
      page: 1,
      pageSize: 10,
      totalElements: 1,
    });
    renderPanel();
    await waitFor(() => expect(screen.getByText('Invoice created')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /invoice created/i }));
    expect(navigateMock).toHaveBeenCalledWith('/my-approvals?instanceId=100');
  });

  it('an APPROVAL notification with no instanceId metadata still routes to the plain My Approvals list', async () => {
    listMock.mockResolvedValue({
      content: [
        makeNotification({
          id: 71,
          businessCategory: 'APPROVAL',
          entityType: 'PurchaseOrder',
          entityId: 9,
          readAt: null,
          metadata: null,
        }),
      ],
      unreadCount: 1,
      page: 1,
      pageSize: 10,
      totalElements: 1,
    });
    renderPanel();
    await waitFor(() => expect(screen.getByText('Invoice created')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /invoice created/i }));
    expect(navigateMock).toHaveBeenCalledWith('/my-approvals');
  });

  it('shows an inline Approve action for an unread APPROVAL notification with instance/node metadata, and calls approvalApi on click', async () => {
    listMock.mockResolvedValue({
      content: [
        makeNotification({
          id: 8,
          businessCategory: 'APPROVAL',
          entityType: 'Leave',
          entityId: 3,
          readAt: null,
          metadata: { instanceId: 55, nodeId: 'node_1' },
        }),
      ],
      unreadCount: 1,
      page: 1,
      pageSize: 10,
      totalElements: 1,
    });
    renderPanel();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(approveMock).toHaveBeenCalledWith(55, { nodeId: 'node_1' }));
    await waitFor(() => expect(markReadMock).toHaveBeenCalledWith(8));
  });

  it('"Mark all as read" appears only when there are unread notifications and clears them', async () => {
    listMock.mockResolvedValue({
      content: [makeNotification({ id: 1, readAt: null })],
      unreadCount: 1,
      page: 1,
      pageSize: 10,
      totalElements: 1,
    });
    renderPanel();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /mark all notifications as read/i })
      ).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole('button', { name: /mark all notifications as read/i }));
    await waitFor(() => expect(markAllReadMock).toHaveBeenCalled());
  });

  it('"View all notifications" navigates to the notifications page and closes the panel', async () => {
    listMock.mockResolvedValue({
      content: [],
      unreadCount: 0,
      page: 1,
      pageSize: 10,
      totalElements: 0,
    });
    const { onClose } = renderPanel();
    await waitFor(() => expect(screen.getByText(/view all notifications/i)).toBeInTheDocument());

    fireEvent.click(screen.getByText(/view all notifications/i));
    expect(navigateMock).toHaveBeenCalledWith('/notifications');
    expect(onClose).toHaveBeenCalled();
  });

  // Audit finding: priority/businessCategory were written by the backend but never rendered.
  it('shows a priority pill for HIGH/CRITICAL notifications, but not for NORMAL/LOW', async () => {
    listMock.mockResolvedValue({
      content: [
        makeNotification({ id: 1, subject: 'Critical one', priority: 'CRITICAL' }),
        makeNotification({ id: 2, subject: 'High one', priority: 'HIGH' }),
        makeNotification({ id: 3, subject: 'Normal one', priority: 'NORMAL' }),
      ],
      unreadCount: 3,
      page: 1,
      pageSize: 10,
      totalElements: 3,
    });
    renderPanel();
    await waitFor(() => expect(screen.getByText('Critical one')).toBeInTheDocument());

    expect(screen.getByText('Critical')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    // "Normal one" row renders with no pill at all — nothing named after its own priority.
    expect(screen.queryByText('Normal')).not.toBeInTheDocument();
  });

  it('reverts the optimistic read state if the mark-read request fails', async () => {
    listMock.mockResolvedValue({
      content: [makeNotification({ id: 9, entityType: null, readAt: null })],
      unreadCount: 1,
      page: 1,
      pageSize: 10,
      totalElements: 1,
    });
    markReadMock.mockRejectedValueOnce(new Error('network down'));
    const { onUnreadCountChange } = renderPanel();
    await waitFor(() => expect(screen.getByText('Invoice created')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /invoice created/i }));

    // Rolled back — the badge callback's last call must reflect the restored unread count (1),
    // not the optimistic 0 it briefly flipped to.
    await waitFor(() => expect(markReadMock).toHaveBeenCalledWith(9));
    await waitFor(() => {
      const calls = onUnreadCountChange.mock.calls;
      expect(calls[calls.length - 1]?.[0]).toBe(1);
    });
  });
});
