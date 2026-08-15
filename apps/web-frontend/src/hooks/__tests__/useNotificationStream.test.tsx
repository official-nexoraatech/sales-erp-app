import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactNode } from 'react';
import { useNotificationStream } from '../useNotificationStream.js';
import { useAuthStore } from '../../store/auth.store.js';
import { NOTIFICATIONS_PANEL_QUERY_KEY } from '../../components/notifications/NotificationsPanel.js';

const unreadCountMock = vi.fn().mockResolvedValue({ count: 0 });

vi.mock('../../api/endpoints.js', () => ({
  notificationsApi: { unreadCount: (...args: unknown[]) => unreadCountMock(...args) },
}));

// A minimal EventSource fake — jsdom has no real implementation. Captures the last-constructed
// instance so a test can drive it by calling `.onmessage` directly, same shape a real SSE
// message event carries (only `.data` is read by the hook).
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  close(): void {
    this.closed = true;
  }
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useNotificationStream', () => {
  beforeEach(() => {
    unreadCountMock.mockReset().mockResolvedValue({ count: 0 });
    FakeEventSource.instances.length = 0;
    vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
    useAuthStore.setState({ accessToken: 'test-token', user: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useAuthStore.setState({ accessToken: null });
  });

  it('returns 0 and opens no connection when there is no access token', () => {
    useAuthStore.setState({ accessToken: null });
    const { result } = renderHook(() => useNotificationStream(), { wrapper });
    expect(result.current).toBe(0);
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('fetches the initial unread count on mount, then updates it from an unread_count SSE message', async () => {
    unreadCountMock.mockResolvedValue({ count: 3 });
    const { result } = renderHook(() => useNotificationStream(), { wrapper });

    await waitFor(() => expect(result.current).toBe(3));
    expect(FakeEventSource.instances).toHaveLength(1);

    const source = FakeEventSource.instances[0]!;
    act(() => {
      source.onmessage?.({ data: JSON.stringify({ type: 'unread_count', count: 5 }) });
    });

    await waitFor(() => expect(result.current).toBe(5));
  });

  it('prepends a new_notifications payload into the shared panel query cache', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(NOTIFICATIONS_PANEL_QUERY_KEY, {
      content: [
        {
          id: 1,
          subject: 'Old',
          body: 'old',
          createdAt: '',
          readAt: null,
          entityType: null,
          entityId: null,
          priority: null,
          businessCategory: null,
          metadata: null,
        },
      ],
      unreadCount: 1,
      page: 1,
      pageSize: 10,
      totalElements: 1,
    });

    renderHook(() => useNotificationStream(), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    const source = FakeEventSource.instances[0]!;
    const newItem = {
      id: 2,
      subject: 'Fresh',
      body: 'fresh',
      createdAt: '',
      readAt: null,
      entityType: null,
      entityId: null,
      priority: null,
      businessCategory: null,
      metadata: null,
    };
    act(() => {
      source.onmessage?.({ data: JSON.stringify({ type: 'new_notifications', items: [newItem] }) });
    });

    await waitFor(() => {
      const cached = qc.getQueryData<{ content: { id: number }[] }>(NOTIFICATIONS_PANEL_QUERY_KEY);
      expect(cached?.content.map((n) => n.id)).toEqual([2, 1]);
    });
  });

  it('ignores malformed SSE payloads instead of throwing', async () => {
    const { result } = renderHook(() => useNotificationStream(), { wrapper });
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    const source = FakeEventSource.instances[0]!;
    expect(() => act(() => source.onmessage?.({ data: 'not json' }))).not.toThrow();
    expect(result.current).toBe(0);
  });

  it('closes the EventSource connection on unmount', async () => {
    const { unmount } = renderHook(() => useNotificationStream(), { wrapper });
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.instances[0]!;

    unmount();
    expect(source.closed).toBe(true);
  });
});
