import { useEffect, useState } from 'react';
import { X, Bell } from 'lucide-react';
import { notificationsApi, type InAppNotification } from '../../api/endpoints.js';

interface NotificationsPanelProps {
  onClose: () => void;
  onUnreadCountChange: (count: number) => void;
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function NotificationsPanel({ onClose, onUnreadCountChange }: NotificationsPanelProps) {
  const [items, setItems] = useState<InAppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    notificationsApi
      .list({ size: 10 })
      .then((res) => {
        setItems(res.content);
        onUnreadCountChange(res.unreadCount);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
    // onUnreadCountChange is a stable setState-derived callback from the parent; omitting
    // it from deps avoids re-fetching on every render without it ever actually changing.
  }, []);

  const markRead = (id: number) => {
    setItems((prev) =>
      prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n))
    );
    onUnreadCountChange(items.filter((n) => n.id !== id && !n.readAt).length);
    notificationsApi.markRead(id).catch(() => {});
  };

  return (
    <div className="absolute right-0 top-12 z-50 w-80 max-h-[28rem] flex flex-col bg-surface-card border border-default rounded-lg shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-default">
        <span className="text-sm font-semibold text-primary">Notifications</span>
        <button
          onClick={onClose}
          aria-label="Close notifications panel"
          className="text-secondary hover:text-primary transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && <p className="p-4 text-sm text-secondary">Loading…</p>}

        {!loading && error && (
          <p className="p-4 text-sm text-red-500">Couldn't load notifications. Try again later.</p>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10 text-secondary">
            <Bell size={24} />
            <p className="text-sm">No notifications yet</p>
          </div>
        )}

        {!loading && !error && items.length > 0 && (
          <ul>
            {items.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => markRead(n.id)}
                  className={`w-full text-left px-4 py-3 border-b border-default hover:bg-surface-raised transition-colors ${
                    n.readAt ? '' : 'bg-info-bg'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {!n.readAt && (
                      <span className="mt-1.5 w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                    )}
                    <div className="min-w-0">
                      {n.subject && (
                        <p className="text-sm font-medium text-primary truncate">{n.subject}</p>
                      )}
                      <p className="text-sm text-secondary line-clamp-2">{n.body}</p>
                      <p className="text-xs text-disabled mt-1">{timeAgo(n.createdAt)}</p>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
