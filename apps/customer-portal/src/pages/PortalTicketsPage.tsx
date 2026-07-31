import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { portalApiClient, PortalApiError } from '../api/portalApiClient.js';

interface TicketRow {
  id: number;
  ticketNumber: string;
  subject: string;
  status: string;
  priority: string;
  createdAt: string;
}

const TICKET_TYPES = ['COMPLAINT', 'INQUIRY', 'RETURN_REQUEST', 'OTHER'] as const;

export function PortalTicketsPage(): React.ReactElement {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [ticketType, setTicketType] = useState<(typeof TICKET_TYPES)[number]>('OTHER');

  const { data, isLoading } = useQuery({
    queryKey: ['portal', 'tickets'],
    queryFn: () =>
      portalApiClient.get<{ content: TicketRow[]; totalElements: number }>(
        'sales',
        '/portal/tickets'
      ),
  });

  const createMut = useMutation({
    mutationFn: () =>
      portalApiClient.post('sales', '/portal/tickets', { subject, description, ticketType }),
    onSuccess: () => {
      toast.success('Ticket submitted');
      setSubject('');
      setDescription('');
      setShowForm(false);
      void queryClient.invalidateQueries({ queryKey: ['portal', 'tickets'] });
    },
    onError: (err) =>
      toast.error(err instanceof PortalApiError ? err.message : 'Could not submit ticket'),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Support</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md bg-[var(--action-primary,#2563eb)] px-3 py-1.5 text-sm font-medium text-white"
        >
          {showForm ? 'Cancel' : 'New request'}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createMut.mutate();
          }}
          className="space-y-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-4"
        >
          <div className="space-y-1">
            <label className="text-sm text-[var(--text-secondary)]">Subject</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
              minLength={2}
              className="w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-page)] px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm text-[var(--text-secondary)]">Type</label>
            <select
              value={ticketType}
              onChange={(e) => setTicketType(e.target.value as (typeof TICKET_TYPES)[number])}
              className="w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-page)] px-3 py-2 text-sm"
            >
              {TICKET_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm text-[var(--text-secondary)]">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-page)] px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={createMut.isPending}
            className="rounded-md bg-[var(--action-primary,#2563eb)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
          >
            {createMut.isPending ? 'Submitting…' : 'Submit'}
          </button>
        </form>
      )}

      {isLoading ? (
        <p className="text-sm text-[var(--text-secondary)]">Loading…</p>
      ) : (data?.content ?? []).length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)]">You have no support requests yet.</p>
      ) : (
        <div className="divide-y divide-[var(--border-default)] rounded-lg border border-[var(--border-default)]">
          {data!.content.map((t) => (
            <Link
              key={t.id}
              to={`/tickets/${t.id}`}
              className="flex items-center justify-between px-4 py-3 text-sm hover:bg-[var(--surface-subtle)]"
            >
              <div>
                <div className="font-medium">{t.subject}</div>
                <div className="text-[var(--text-secondary)]">{t.ticketNumber}</div>
              </div>
              <div className="text-[var(--text-secondary)]">{t.status}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
