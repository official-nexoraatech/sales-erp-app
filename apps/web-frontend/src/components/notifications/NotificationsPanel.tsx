import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { X, Bell, CheckCheck } from 'lucide-react';
import { notificationsApi, approvalApi, type InAppNotification } from '../../api/endpoints.js';
import { getNotificationClickRoute } from '../../lib/notificationEntityConfig.js';
import { PriorityPill, categoryLabel } from './PriorityPill.js';

interface NotificationsPanelProps {
  onClose: () => void;
  onUnreadCountChange: (count: number) => void;
}

/** Shared with useNotificationStream.ts (live SSE push) and NotificationsPage.tsx (view-all) so
 * a read/mark-all-read/new-item update in one place is reflected everywhere without a refetch. */
export const NOTIFICATIONS_PANEL_QUERY_KEY = ['notifications', 'panel'] as const;

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
  const navigate = useNavigate();
  const qc = useQueryClient();
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape — same pattern as ERPDropdownMenu. The click that opens
  // this panel (the bell button) has already fully dispatched by the time this effect attaches
  // post-mount, so it never sees — and doesn't need to special-case — its own opening click.
  useEffect(() => {
    function handleMouseDown(e: MouseEvent): void {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    }
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  // Focus management for the popup dialog: move focus in on open, trap Tab/Shift+Tab inside
  // it while open, and return focus to whatever triggered it (the bell button) on close —
  // standard WAI-ARIA dialog behavior, absent before this fix.
  useEffect(() => {
    const triggerEl = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    function focusables(): HTMLElement[] {
      if (!panelRef.current) return [];
      return Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button, a[href], [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute('disabled'));
    }
    function handleTabTrap(e: KeyboardEvent): void {
      if (e.key !== 'Tab' || !panelRef.current) return;
      const els = focusables();
      if (els.length === 0) return;
      const first = els[0]!;
      const last = els[els.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', handleTabTrap);
    return () => {
      document.removeEventListener('keydown', handleTabTrap);
      triggerEl?.focus();
    };
  }, []);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: NOTIFICATIONS_PANEL_QUERY_KEY,
    queryFn: () => notificationsApi.list({ pageSize: 10 }),
  });
  const items = data?.content ?? [];

  // Keep Layout.tsx's bell badge (a separate, SSE-driven counter) in sync whenever this
  // query's own unreadCount changes — mirrors the panel's previous behavior exactly.
  useEffect(() => {
    if (data) onUnreadCountChange(data.unreadCount);
  }, [data, onUnreadCountChange]);

  const markReadMutation = useMutation({
    mutationFn: (id: number) => notificationsApi.markRead(id),
    onMutate: async (id) => {
      const previous = qc.getQueryData<typeof data>(NOTIFICATIONS_PANEL_QUERY_KEY);
      qc.setQueryData(NOTIFICATIONS_PANEL_QUERY_KEY, (old: typeof data) => {
        if (!old) return old;
        const target = old.content.find((n) => n.id === id);
        if (!target || target.readAt) return old;
        return {
          ...old,
          content: old.content.map((n) =>
            n.id === id ? { ...n, readAt: new Date().toISOString() } : n
          ),
          unreadCount: Math.max(0, old.unreadCount - 1),
        };
      });
      return { previous };
    },
    // The backend is authoritative — if the request never actually landed, the optimistic
    // "read" flip must not stick around forever silently disagreeing with server state.
    onError: (_err, _id, context) => {
      if (context?.previous) qc.setQueryData(NOTIFICATIONS_PANEL_QUERY_KEY, context.previous);
      toast.error('Failed to mark as read');
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => {
      qc.setQueryData(NOTIFICATIONS_PANEL_QUERY_KEY, (old: typeof data) =>
        old
          ? {
              ...old,
              content: old.content.map((n) => ({
                ...n,
                readAt: n.readAt ?? new Date().toISOString(),
              })),
              unreadCount: 0,
            }
          : old
      );
    },
    onError: () => toast.error('Failed to mark all as read'),
  });

  function handleRowClick(n: InAppNotification) {
    if (!n.readAt) markReadMutation.mutate(n.id);
    const route = getNotificationClickRoute(n);
    if (route) {
      onClose();
      navigate(route);
    }
  }

  function handleApprove(n: InAppNotification, e: React.MouseEvent) {
    e.stopPropagation();
    const meta = n.metadata as { instanceId?: number; nodeId?: string } | null;
    if (!meta?.instanceId || !meta.nodeId) return;
    approvalApi
      .approve(meta.instanceId, { nodeId: meta.nodeId })
      .then(() => {
        markReadMutation.mutate(n.id);
        toast.success('Approved');
      })
      .catch(() => toast.error('Failed to approve — it may have already been decided'));
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Notifications"
      tabIndex={-1}
      className="absolute right-0 top-12 z-50 w-80 max-h-[28rem] flex flex-col bg-surface-card border border-default rounded-lg shadow-2xl overflow-hidden focus:outline-none"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-default gap-2">
        <span className="text-sm font-semibold text-primary">Notifications</span>
        <div className="flex items-center gap-1">
          {!isLoading && !isError && (data?.unreadCount ?? 0) > 0 && (
            <button
              onClick={() => markAllReadMutation.mutate()}
              disabled={markAllReadMutation.isPending}
              aria-label="Mark all notifications as read"
              title="Mark all as read"
              className="p-1 rounded text-secondary hover:text-primary hover:bg-surface-raised transition-colors disabled:opacity-50"
            >
              <CheckCheck size={15} />
            </button>
          )}
          <button
            onClick={onClose}
            aria-label="Close notifications panel"
            className="p-1 rounded text-secondary hover:text-primary transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading && <p className="p-4 text-sm text-secondary">Loading…</p>}

        {!isLoading && isError && (
          <div className="p-4 text-sm text-center">
            <p className="text-red-500 mb-2">Unable to load notifications.</p>
            <button onClick={() => refetch()} className="text-brand hover:underline">
              Retry
            </button>
          </div>
        )}

        {!isLoading && !isError && items.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10 text-secondary">
            <Bell size={24} />
            <p className="text-sm">You're all caught up</p>
            <p className="text-xs">You don't have any new notifications.</p>
          </div>
        )}

        {!isLoading && !isError && items.length > 0 && (
          <ul>
            {items.map((n) => {
              const meta = n.metadata as { instanceId?: number; nodeId?: string } | null;
              const canApproveInline =
                n.businessCategory === 'APPROVAL' && !n.readAt && meta?.instanceId && meta.nodeId;
              return (
                <li key={n.id}>
                  {/* A plain <button> can't contain the nested Approve <button> below (invalid
                      HTML — browsers/React both reject button-in-button) — a keyboard-operable
                      div takes its place instead. */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => handleRowClick(n)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleRowClick(n);
                      }
                    }}
                    className={`w-full text-left px-4 py-3 border-b border-default hover:bg-surface-raised transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                      n.readAt ? '' : 'bg-info-bg'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {!n.readAt && (
                        <span className="mt-1.5 w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        {n.subject && (
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-medium text-primary truncate">{n.subject}</p>
                            <PriorityPill priority={n.priority} />
                          </div>
                        )}
                        <p className="text-sm text-secondary line-clamp-2">{n.body}</p>
                        <p className="text-xs text-disabled mt-1">
                          {timeAgo(n.createdAt)}
                          {categoryLabel(n.businessCategory) &&
                            ` · ${categoryLabel(n.businessCategory)}`}
                        </p>
                        {canApproveInline && (
                          <div className="flex items-center gap-2 mt-2">
                            <button
                              onClick={(e) => handleApprove(n, e)}
                              className="px-2.5 py-1 rounded text-xs font-medium bg-primary text-primary-fg hover:bg-primary-hover transition-colors"
                            >
                              Approve
                            </button>
                            <span className="text-xs text-secondary">Click row to review</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <button
        onClick={() => {
          onClose();
          navigate('/notifications');
        }}
        className="px-4 py-2.5 border-t border-default text-sm text-brand hover:bg-surface-raised transition-colors text-center shrink-0"
      >
        View all notifications →
      </button>
    </div>
  );
}
