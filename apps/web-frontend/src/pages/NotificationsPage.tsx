import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Bell, CheckCheck } from 'lucide-react';
import { notificationsApi, type InAppNotification } from '../api/endpoints.js';
import { getNotificationClickRoute } from '../lib/notificationEntityConfig.js';
import { PriorityPill, categoryLabel } from '../components/notifications/PriorityPill.js';
import ERPPageHeader from '../components/erp/ERPPageHeader.js';
import ERPEmptyState from '../components/erp/ERPEmptyState.js';
import ERPPagination from '../components/erp/ERPPagination.js';
import { ERPCardSkeleton } from '../components/erp/ERPSkeleton.js';

const CATEGORIES: Array<{ value: string; label: string }> = [
  { value: 'APPROVAL', label: 'Approvals' },
  { value: 'SALES', label: 'Sales' },
  { value: 'CRM', label: 'CRM' },
  { value: 'INVENTORY', label: 'Inventory' },
  { value: 'FINANCE', label: 'Finance' },
  { value: 'WORKFLOW', label: 'Workflow' },
  { value: 'SYSTEM', label: 'System' },
];

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return date.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function NotificationsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [businessCategory, setBusinessCategory] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['notifications', 'page', { page, pageSize, businessCategory, unreadOnly }],
    queryFn: () => notificationsApi.list({ page, pageSize, businessCategory, unreadOnly }),
  });
  const items = data?.content ?? [];

  function invalidateAll(): void {
    void qc.invalidateQueries({ queryKey: ['notifications'], exact: false });
  }

  const markReadMutation = useMutation({
    mutationFn: (id: number) => notificationsApi.markRead(id),
    onSuccess: invalidateAll,
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => {
      invalidateAll();
      toast.success('All notifications marked as read');
    },
    onError: () => toast.error('Failed to mark all as read'),
  });

  function handleRowClick(n: InAppNotification): void {
    if (!n.readAt) markReadMutation.mutate(n.id);
    const route = getNotificationClickRoute(n);
    if (route) navigate(route);
  }

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Notifications"
        subtitle="Everything that needs your attention, in one place."
        icon={Bell}
        actions={
          (data?.unreadCount ?? 0) > 0 ? (
            <button
              onClick={() => markAllReadMutation.mutate()}
              disabled={markAllReadMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-secondary hover:bg-surface-raised transition-colors disabled:opacity-50"
            >
              <CheckCheck size={15} />
              Mark all as read
            </button>
          ) : undefined
        }
      />

      <div className="flex items-center gap-4 mb-4 border-b border-default">
        <div className="flex gap-1">
          {(['All', 'Unread'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => {
                setUnreadOnly(tab === 'Unread');
                setPage(1);
              }}
              aria-pressed={unreadOnly === (tab === 'Unread')}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                unreadOnly === (tab === 'Unread')
                  ? 'border-brand text-brand'
                  : 'border-transparent text-secondary hover:text-primary'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <button
          onClick={() => {
            setBusinessCategory(undefined);
            setPage(1);
          }}
          aria-pressed={businessCategory === undefined}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
            businessCategory === undefined
              ? 'bg-primary text-primary-fg'
              : 'bg-surface-raised text-secondary hover:text-primary'
          }`}
        >
          All categories
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            onClick={() => {
              setBusinessCategory(c.value);
              setPage(1);
            }}
            aria-pressed={businessCategory === c.value}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              businessCategory === c.value
                ? 'bg-primary text-primary-fg'
                : 'bg-surface-raised text-secondary hover:text-primary'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <ERPCardSkeleton key={i} lines={2} />
          ))}
        </div>
      )}

      {!isLoading && isError && (
        <div className="text-center py-10">
          <p className="text-sm text-red-500 mb-2">Unable to load notifications.</p>
          <button onClick={() => refetch()} className="text-sm text-brand hover:underline">
            Retry
          </button>
        </div>
      )}

      {!isLoading && !isError && items.length === 0 && (
        <ERPEmptyState
          icon={Bell}
          title="You're all caught up"
          description="You don't have any notifications here."
        />
      )}

      {!isLoading && !isError && items.length > 0 && (
        <div className="bg-surface-card border border-default rounded-xl overflow-hidden">
          <ul className="divide-y divide-default">
            {items.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => handleRowClick(n)}
                  className={`w-full text-left px-5 py-4 hover:bg-surface-raised transition-colors ${
                    n.readAt ? '' : 'bg-info-bg'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {!n.readAt && (
                      <span className="mt-2 w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {n.subject && (
                            <p className="text-sm font-medium text-primary truncate">{n.subject}</p>
                          )}
                          <PriorityPill priority={n.priority} />
                        </div>
                        <span className="text-xs text-disabled shrink-0">
                          {formatTimestamp(n.createdAt)}
                        </span>
                      </div>
                      <p className="text-sm text-secondary mt-0.5">{n.body}</p>
                      {categoryLabel(n.businessCategory) && (
                        <p className="text-xs text-disabled mt-1">
                          {categoryLabel(n.businessCategory)}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <ERPPagination
            page={page}
            pageSize={pageSize}
            total={data?.totalElements ?? 0}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        </div>
      )}
    </div>
  );
}
