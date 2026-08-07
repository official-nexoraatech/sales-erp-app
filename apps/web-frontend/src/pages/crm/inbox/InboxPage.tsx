import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { conversationApi } from '../../../api/endpoints.js';
import { useAuthStore } from '../../../store/auth.store.js';
import { PERMISSIONS } from '../../../constants/permissions.js';
import ERPPageHeader from '../../../components/erp/ERPPageHeader.js';
import ERPEmptyState from '../../../components/erp/ERPEmptyState.js';
import Button from '../../../components/ui/Button.js';
import Badge from '../../../components/ui/Badge.js';
import { formatDatetime } from '../../../lib/format.js';

interface Conversation {
  id: number;
  customerId: number | null;
  channel: 'WHATSAPP' | 'SMS' | 'EMAIL' | 'INSTAGRAM';
  externalAddress: string;
  status: 'OPEN' | 'ASSIGNED' | 'CLOSED';
  assignedTo: number | null;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  unreadCount: number;
}

interface ConversationMessage {
  id: number;
  direction: 'INBOUND' | 'OUTBOUND';
  body: string;
  createdAt: string;
}

interface CannedResponse {
  id: number;
  title: string;
  body: string;
}

const CHANNEL_COLORS: Record<string, 'green' | 'blue' | 'gray' | 'indigo'> = {
  WHATSAPP: 'green',
  SMS: 'blue',
  EMAIL: 'gray',
  INSTAGRAM: 'indigo',
};

// CRM-ROADMAP Phase 2, Feature 5 — Omnichannel Communication Hub. A split-pane inbox:
// conversation list (left) + thread (center) + a compact customer-context strip. No true
// "Customer 360 embed" panel (kept lean — a link into the full Customer 360 page instead of
// duplicating its cards here, avoiding scope creep on an already-large feature).
export default function InboxPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canReply = hasPermission(PERMISSIONS.CONVERSATION_REPLY);
  const canAssign = hasPermission(PERMISSIONS.CONVERSATION_ASSIGN);

  const [statusFilter, setStatusFilter] = useState<'' | 'OPEN' | 'ASSIGNED' | 'CLOSED'>('OPEN');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [showCanned, setShowCanned] = useState(false);

  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: ['conversations', statusFilter],
    queryFn: () => conversationApi.list(statusFilter ? { status: statusFilter } : undefined),
  });
  const conversations: Conversation[] = (listData as { content?: Conversation[] })?.content ?? [];

  const { data: detailData } = useQuery({
    queryKey: ['conversation', selectedId],
    queryFn: () => conversationApi.getById(selectedId!),
    enabled: selectedId !== null,
  });
  const detail = detailData as (Conversation & { messages: ConversationMessage[] }) | undefined;

  const { data: cannedData } = useQuery({
    queryKey: ['canned-responses'],
    queryFn: () => conversationApi.listCannedResponses(),
    enabled: showCanned,
  });
  const cannedResponses: CannedResponse[] =
    (cannedData as { content?: CannedResponse[] })?.content ?? [];

  const replyMut = useMutation({
    mutationFn: () => conversationApi.reply(selectedId!, replyBody),
    onSuccess: () => {
      setReplyBody('');
      qc.invalidateQueries({ queryKey: ['conversation', selectedId] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to send reply'),
  });

  const assignToMeMut = useMutation({
    mutationFn: (userId: number) => conversationApi.assign(selectedId!, userId),
    onSuccess: () => {
      toast.success('Conversation assigned');
      qc.invalidateQueries({ queryKey: ['conversation', selectedId] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to assign conversation'),
  });

  const closeMut = useMutation({
    mutationFn: () => conversationApi.close(selectedId!),
    onSuccess: () => {
      toast.success('Conversation closed');
      qc.invalidateQueries({ queryKey: ['conversation', selectedId] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to close conversation'),
  });

  const currentUserId = useAuthStore((s) => s.user?.id);

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Inbox"
        subtitle="WhatsApp, Instagram, SMS and email replies in one thread per customer"
      />

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4 h-[calc(100vh-220px)] min-h-[500px]">
        {/* Conversation list */}
        <div className="bg-surface-card rounded-xl border border-default flex flex-col overflow-hidden">
          <div className="flex gap-1 p-2 border-b border-default flex-wrap">
            {(['', 'OPEN', 'ASSIGNED', 'CLOSED'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                aria-pressed={statusFilter === s}
                className={`px-2 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                  statusFilter === s
                    ? 'bg-primary text-white border-primary'
                    : 'border-default text-secondary hover:bg-surface-raised'
                }`}
              >
                {s || 'All'}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-default">
            {listLoading ? (
              <p className="text-xs text-secondary p-4">Loading…</p>
            ) : conversations.length === 0 ? (
              <ERPEmptyState
                type="no-data"
                title="No conversations"
                description="Inbound replies will appear here."
              />
            ) : (
              conversations.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`w-full text-left px-3 py-3 hover:bg-surface-raised ${
                    selectedId === c.id ? 'bg-primary-subtle' : ''
                  }`}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-primary truncate">
                      {c.externalAddress}
                    </span>
                    <Badge label={c.channel} color={CHANNEL_COLORS[c.channel] ?? 'gray'} />
                    {c.unreadCount > 0 && <Badge label={String(c.unreadCount)} color="red" />}
                  </div>
                  <p className="text-xs text-secondary truncate mt-0.5">{c.lastMessagePreview}</p>
                  <p className="text-xs text-disabled mt-0.5">{formatDatetime(c.lastMessageAt)}</p>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Thread + context */}
        <div className="bg-surface-card rounded-xl border border-default flex flex-col overflow-hidden">
          {!detail ? (
            <ERPEmptyState
              type="no-data"
              title="Select a conversation"
              description="Pick a conversation from the list to view its thread."
            />
          ) : (
            <>
              <div className="px-4 py-3 border-b border-default flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-primary">{detail.externalAddress}</p>
                  <p className="text-xs text-secondary">
                    {detail.customerId ? (
                      <button
                        onClick={() => navigate(`/customers/${detail.customerId}`)}
                        className="text-link hover:underline"
                      >
                        View Customer 360
                      </button>
                    ) : (
                      'Unknown sender'
                    )}
                  </p>
                </div>
                <Badge
                  label={detail.status}
                  color={detail.status === 'CLOSED' ? 'gray' : 'green'}
                />
                {canAssign && detail.status !== 'CLOSED' && (
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => assignToMeMut.mutate(currentUserId!)}
                    >
                      Assign to me
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => closeMut.mutate()}>
                      Close
                    </Button>
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto divide-y divide-default">
                {detail.messages.length === 0 ? (
                  <ERPEmptyState type="no-data" title="No messages yet" />
                ) : (
                  detail.messages.map((m) => (
                    <div
                      key={m.id}
                      className={`px-4 py-3 ${m.direction === 'OUTBOUND' ? 'bg-primary-subtle' : ''}`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Badge
                          label={m.direction === 'OUTBOUND' ? 'Sent' : 'Received'}
                          color={m.direction === 'OUTBOUND' ? 'blue' : 'green'}
                        />
                        <span className="text-xs text-secondary">
                          {formatDatetime(m.createdAt)}
                        </span>
                      </div>
                      <p className="text-sm text-primary whitespace-pre-wrap">{m.body}</p>
                    </div>
                  ))
                )}
              </div>

              {canReply && detail.status !== 'CLOSED' && (
                <div className="p-3 border-t border-default space-y-2">
                  {showCanned && (
                    <div className="max-h-32 overflow-y-auto rounded-lg border border-default divide-y divide-default">
                      {cannedResponses.map((r) => (
                        <button
                          key={r.id}
                          onClick={() => {
                            setReplyBody(r.body);
                            setShowCanned(false);
                          }}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-surface-raised"
                        >
                          <span className="font-semibold text-primary">{r.title}</span>
                          <p className="text-secondary truncate">{r.body}</p>
                        </button>
                      ))}
                    </div>
                  )}
                  <textarea
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value)}
                    rows={2}
                    placeholder="Write a reply…"
                    className="w-full rounded-lg border border-default bg-surface-card text-primary text-sm px-3 py-2 resize-none"
                  />
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setShowCanned((s) => !s)}>
                      Canned Responses
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => replyMut.mutate()}
                      disabled={replyMut.isPending || !replyBody.trim()}
                    >
                      Send
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
