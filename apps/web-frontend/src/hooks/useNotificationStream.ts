import { useEffect, useRef, useState } from 'react';
import { notificationServiceUrl } from '../api/client.js';
import { notificationsApi } from '../api/endpoints.js';
import { useAuthStore } from '../store/auth.store.js';

// Native EventSource can't set an Authorization header, so the token travels
// as a query param — see apps/notification-service/src/middleware/authenticate.ts.
export function useNotificationStream(): number {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [unreadCount, setUnreadCount] = useState(0);
  const sourceRef = useRef<EventSource | null>(null);

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
        const payload = JSON.parse(event.data) as { type: string; count?: number };
        if (payload.type === 'unread_count' && typeof payload.count === 'number') {
          setUnreadCount(payload.count);
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
  }, [accessToken]);

  return unreadCount;
}
