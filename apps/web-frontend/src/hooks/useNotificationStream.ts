import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { notificationServiceUrl } from '../api/client.js';
import { notificationsApi, type InAppNotification } from '../api/endpoints.js';
import { useAuthStore } from '../store/auth.store.js';
import { NOTIFICATIONS_PANEL_QUERY_KEY } from '../components/notifications/NotificationsPanel.js';

// Native EventSource can't set an Authorization header, so the token travels
// as a query param — see apps/notification-service/src/middleware/authenticate.ts.
export function useNotificationStream(): number {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [unreadCount, setUnreadCount] = useState(0);
  const sourceRef = useRef<EventSource | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    if (!accessToken) {
      setUnreadCount(0);
      return;
    }

    notificationsApi
      .unreadCount()
      .then((res) => setUnreadCount(res.count))
      .catch(() => {});

    const source = new EventSource(
      `${notificationServiceUrl()}/notifications/stream?token=${encodeURIComponent(accessToken)}`
    );
    sourceRef.current = source;

    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as {
          type: string;
          count?: number;
          items?: InAppNotification[];
        };
        if (payload.type === 'unread_count' && typeof payload.count === 'number') {
          setUnreadCount(payload.count);
        }
        if (payload.type === 'new_notifications' && payload.items?.length) {
          const newItems = payload.items;
          // Prepend into the panel's cached page so it live-updates without the user having to
          // reopen it, and drop the same query so the "View all notifications" page (a
          // different, paginated/filtered query under the same 'notifications' key) refetches
          // rather than silently going stale — a single write path for both surfaces.
          qc.setQueryData(
            NOTIFICATIONS_PANEL_QUERY_KEY,
            (old: Awaited<ReturnType<typeof notificationsApi.list>> | undefined) => {
              if (!old) return old;
              const existingIds = new Set(old.content.map((n) => n.id));
              const merged = [...newItems.filter((n) => !existingIds.has(n.id)), ...old.content];
              return { ...old, content: merged.slice(0, old.pageSize) };
            }
          );
          void qc.invalidateQueries({ queryKey: ['notifications'], exact: false });
        }
      } catch {
        // ignore malformed events
      }
    };

    source.onerror = () => {
      // EventSource auto-reconnects; nothing to do here beyond letting it retry.
    };

    return () => {
      source.close();
      sourceRef.current = null;
    };
  }, [accessToken, qc]);

  return unreadCount;
}
