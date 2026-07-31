import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import { portalApiClient, PortalApiError } from '../api/portalApiClient.js';

interface Ticket {
  id: number;
  ticketNumber: string;
  subject: string;
  description: string | null;
  status: string;
}

interface Message {
  id: number;
  authorName: string;
  body: string;
  createdAt: string;
}

export function PortalTicketDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [reply, setReply] = useState('');

  const { data: ticket, isLoading: ticketLoading } = useQuery({
    queryKey: ['portal', 'tickets', id],
    queryFn: () => portalApiClient.get<Ticket>('sales', `/portal/tickets/${id}`),
  });

  const { data: messages, isLoading: messagesLoading } = useQuery({
    queryKey: ['portal', 'tickets', id, 'messages'],
    queryFn: () =>
      portalApiClient.get<{ content: Message[] }>('sales', `/portal/tickets/${id}/messages`),
  });

  const replyMut = useMutation({
    mutationFn: () =>
      portalApiClient.post('sales', `/portal/tickets/${id}/messages`, { body: reply }),
    onSuccess: () => {
      setReply('');
      void queryClient.invalidateQueries({ queryKey: ['portal', 'tickets', id, 'messages'] });
    },
    onError: (err) =>
      toast.error(err instanceof PortalApiError ? err.message : 'Could not send reply'),
  });

  if (ticketLoading) return <p className="text-sm text-[var(--text-secondary)]">Loading…</p>;
  if (!ticket) return <p className="text-sm text-[var(--text-secondary)]">Ticket not found.</p>;

  return (
    <div className="space-y-4">
      <Link
        to="/tickets"
        className="flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:underline"
      >
        <ArrowLeft size={16} /> Back to support
      </Link>
      <div>
        <h1 className="text-xl font-semibold">{ticket.subject}</h1>
        <p className="text-sm text-[var(--text-secondary)]">
          {ticket.ticketNumber} · {ticket.status}
        </p>
        {ticket.description && <p className="mt-2 text-sm">{ticket.description}</p>}
      </div>

      <div className="space-y-3">
        {messagesLoading ? (
          <p className="text-sm text-[var(--text-secondary)]">Loading messages…</p>
        ) : (
          (messages?.content ?? []).map((m) => (
            <div
              key={m.id}
              className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-3"
            >
              <div className="mb-1 text-xs font-medium text-[var(--text-secondary)]">
                {m.authorName} · {new Date(m.createdAt).toLocaleString()}
              </div>
              <div className="text-sm">{m.body}</div>
            </div>
          ))
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (reply.trim()) replyMut.mutate();
        }}
        className="space-y-2"
      >
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={3}
          placeholder="Write a reply…"
          className="w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-page)] px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={replyMut.isPending || !reply.trim()}
          className="rounded-md bg-[var(--action-primary,#2563eb)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {replyMut.isPending ? 'Sending…' : 'Send reply'}
        </button>
      </form>
    </div>
  );
}
