import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { copilotApi, type CopilotConversation, type CopilotMessage } from '../api/endpoints.js';
import ERPPageHeader from '../components/erp/ERPPageHeader.js';
import { ERPCardSkeleton } from '../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../components/erp/ERPEmptyState.js';
import Button from '../components/ui/Button.js';
import { formatDatetime } from '../lib/format.js';

export default function CopilotChatPage() {
  const qc = useQueryClient();
  const [activeConversationId, setActiveConversationId] = useState<number | 'new'>('new');
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: ['copilot-conversations'],
    queryFn: () => copilotApi.listConversations(),
  });
  const conversations: CopilotConversation[] = listData?.content ?? [];

  const { data: messagesData, isLoading: messagesLoading } = useQuery({
    queryKey: ['copilot-messages', activeConversationId],
    queryFn: () => copilotApi.getMessages(activeConversationId as number),
    enabled: typeof activeConversationId === 'number',
  });
  const messages: CopilotMessage[] = messagesData?.content ?? [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const sendMutation = useMutation({
    mutationFn: (message: string) => copilotApi.sendMessage(activeConversationId, message),
    onSuccess: (result) => {
      setDraft('');
      if (activeConversationId === 'new') {
        setActiveConversationId(result.conversationId);
      }
      void qc.invalidateQueries({ queryKey: ['copilot-conversations'] });
      void qc.invalidateQueries({ queryKey: ['copilot-messages', result.conversationId] });
    },
    onError: (err: Error) => toast.error(err.message || 'Copilot is unavailable right now'),
  });

  function handleSend() {
    const trimmed = draft.trim();
    if (!trimmed || sendMutation.isPending) return;
    sendMutation.mutate(trimmed);
  }

  return (
    <div className="space-y-6">
      <ERPPageHeader
        variant="list"
        title="AI Copilot"
        subtitle="Ask questions about your data, run reports, and draft messages — read-only in this version, nothing is sent or saved without you doing it yourself"
        actions={
          <Button variant="secondary" onClick={() => setActiveConversationId('new')}>
            New Conversation
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="card p-4 lg:col-span-1">
          <h3 className="text-sm font-semibold text-primary mb-3">Conversations</h3>
          {listLoading ? (
            <ERPCardSkeleton lines={4} />
          ) : conversations.length === 0 ? (
            <p className="text-xs text-secondary">No conversations yet — say hello!</p>
          ) : (
            <div className="space-y-1">
              {conversations.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setActiveConversationId(c.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    activeConversationId === c.id
                      ? 'bg-surface-hover text-primary'
                      : 'text-secondary hover:bg-surface-hover'
                  }`}
                >
                  <p className="truncate">{c.title ?? 'New conversation'}</p>
                  <p className="text-xs text-secondary">{formatDatetime(c.updatedAt)}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="card p-4 lg:col-span-3 flex flex-col" style={{ height: '65vh' }}>
          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            {typeof activeConversationId === 'number' && messagesLoading ? (
              <ERPCardSkeleton lines={4} />
            ) : messages.length === 0 ? (
              <ERPEmptyState
                type="no-data"
                title="Ask the Copilot anything"
                description='Try "show my recent invoices" or "draft a follow-up email for customer X" — it can read data but never writes or sends anything for you.'
              />
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-lg px-4 py-2 text-sm whitespace-pre-wrap ${
                      m.role === 'user'
                        ? 'bg-primary text-primary-fg'
                        : 'bg-surface-subtle text-primary border border-default'
                    }`}
                  >
                    {m.content}
                    {m.toolCalls && m.toolCalls.length > 0 && (
                      <p className="mt-2 text-xs opacity-70">
                        Used: {m.toolCalls.map((t) => t.toolName).join(', ')}
                      </p>
                    )}
                  </div>
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>

          <div className="flex gap-2 pt-3 border-t border-default mt-3">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              rows={2}
              placeholder="Ask a question, or ask for a draft…"
              className="flex-1 rounded-lg border border-default bg-surface-card text-primary text-sm px-3 py-2 resize-none"
            />
            <Button variant="primary" loading={sendMutation.isPending} onClick={handleSend}>
              Send
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
