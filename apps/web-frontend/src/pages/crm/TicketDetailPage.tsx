import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ticketApi, customerApi, invoiceApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPDetailSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Modal from '../../components/ui/Modal.js';
import { formatDatetime, formatCurrency } from '../../lib/format.js';
import {
  ticketMessageSchema,
  type TicketMessageFormData,
  type TICKET_STATUSES,
} from '../../schemas/ticket.schema.js';

interface Ticket {
  id: number;
  ticketNumber: string;
  subject: string;
  description?: string;
  status: (typeof TICKET_STATUSES)[number];
  priority: string;
  customerId: number;
  linkedInvoiceId?: number;
  slaDueAt?: string;
  slaBreached: boolean;
  version: number;
}

interface Message {
  id: number;
  authorName: string;
  visibility: 'INTERNAL' | 'CUSTOMER_VISIBLE';
  body: string;
  createdAt: string;
}

const STATUS_COLOR: Record<string, 'blue' | 'yellow' | 'green' | 'gray'> = {
  OPEN: 'blue',
  IN_PROGRESS: 'yellow',
  WAITING_ON_CUSTOMER: 'yellow',
  RESOLVED: 'green',
  CLOSED: 'gray',
};

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const ticketId = Number(id);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canUpdate = hasPermission(PERMISSIONS.TICKET_UPDATE);
  const canResolve = hasPermission(PERMISSIONS.TICKET_RESOLVE);

  const [csatOpen, setCsatOpen] = useState(false);
  const [csatRating, setCsatRating] = useState(5);

  const { data, isLoading } = useQuery({
    queryKey: ['tickets', id],
    queryFn: () => ticketApi.getById(ticketId),
  });
  const ticket = data as Ticket | undefined;

  const { data: customerData } = useQuery({
    queryKey: ['customers', ticket?.customerId],
    queryFn: () => customerApi.getById(ticket!.customerId),
    enabled: !!ticket?.customerId,
  });
  const customer = customerData as Record<string, unknown> | undefined;

  const { data: invoiceData } = useQuery({
    queryKey: ['invoices', ticket?.linkedInvoiceId],
    queryFn: () => invoiceApi.getById(ticket!.linkedInvoiceId!),
    enabled: !!ticket?.linkedInvoiceId,
  });
  const invoice = invoiceData as Record<string, unknown> | undefined;

  const { data: messagesData } = useQuery({
    queryKey: ['ticket-messages', id],
    queryFn: () => ticketApi.listMessages(ticketId),
  });
  const messages: Message[] = (messagesData as { content?: Message[] })?.content ?? [];

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TicketMessageFormData>({
    resolver: zodResolver(ticketMessageSchema),
    defaultValues: { visibility: 'CUSTOMER_VISIBLE', body: '' },
  });

  const messageMut = useMutation({
    mutationFn: (d: TicketMessageFormData) => ticketApi.addMessage(ticketId, d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ticket-messages', id] });
      reset({ visibility: 'CUSTOMER_VISIBLE', body: '' });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const statusMut = useMutation({
    mutationFn: (status: string) =>
      ticketApi.update(ticketId, { version: ticket!.version, status }),
    onSuccess: () => {
      toast.success('Ticket updated');
      qc.invalidateQueries({ queryKey: ['tickets', id] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const reopenMut = useMutation({
    mutationFn: () => ticketApi.reopen(ticketId),
    onSuccess: () => {
      toast.success('Ticket reopened');
      qc.invalidateQueries({ queryKey: ['tickets', id] });
      qc.invalidateQueries({ queryKey: ['ticket-messages', id] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const csatMut = useMutation({
    mutationFn: () => ticketApi.recordCsat(ticketId, { rating: csatRating }),
    onSuccess: () => {
      toast.success('CSAT recorded');
      setCsatOpen(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) return <ERPDetailSkeleton />;
  if (!ticket) return <ERPEmptyState type="no-data" title="Ticket not found" />;

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title={ticket.subject}
        subtitle={ticket.ticketNumber}
        actions={
          <div className="flex gap-2 flex-wrap">
            {canUpdate && ticket.status === 'CLOSED' && (
              <Button
                variant="secondary"
                onClick={() => reopenMut.mutate()}
                disabled={reopenMut.isPending}
              >
                Reopen
              </Button>
            )}
            {canUpdate && ticket.status !== 'CLOSED' && ticket.status !== 'RESOLVED' && (
              <Button variant="secondary" onClick={() => statusMut.mutate('RESOLVED')}>
                Mark Resolved
              </Button>
            )}
            {canUpdate && ticket.status === 'RESOLVED' && (
              <Button variant="secondary" onClick={() => statusMut.mutate('CLOSED')}>
                Close Ticket
              </Button>
            )}
            {canResolve && ticket.status === 'CLOSED' && (
              <Button variant="secondary" onClick={() => setCsatOpen(true)}>
                Record CSAT
              </Button>
            )}
            <Button variant="secondary" onClick={() => navigate('/crm/tickets')}>
              Back
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <Badge
          label={ticket.status.replace(/_/g, ' ')}
          color={STATUS_COLOR[ticket.status] ?? 'gray'}
        />
        <Badge label={ticket.priority} color="blue" />
        {ticket.slaBreached && <Badge label="SLA BREACHED" color="red" />}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {ticket.description && (
            <div className="bg-surface-card rounded-xl border border-default p-5">
              <h2 className="text-sm font-semibold text-secondary mb-2 uppercase tracking-wide">
                Description
              </h2>
              <p className="text-sm text-primary">{ticket.description}</p>
            </div>
          )}

          <div className="bg-surface-card rounded-xl border border-default">
            <div className="px-5 py-4 border-b border-default">
              <h2 className="text-sm font-semibold text-secondary uppercase tracking-wide">
                Message Thread
              </h2>
            </div>
            <div className="divide-y divide-default">
              {messages.length === 0 ? (
                <ERPEmptyState type="no-data" title="No messages yet" />
              ) : (
                messages.map((m) => (
                  <div
                    key={m.id}
                    className={`px-5 py-3 ${m.visibility === 'INTERNAL' ? 'bg-warning-subtle' : ''}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-primary">{m.authorName}</span>
                      <Badge
                        label={m.visibility === 'INTERNAL' ? 'Internal note' : 'Customer-visible'}
                        color={m.visibility === 'INTERNAL' ? 'yellow' : 'green'}
                      />
                    </div>
                    <p className="text-sm text-primary whitespace-pre-wrap">{m.body}</p>
                    <p className="text-xs text-secondary mt-1">{formatDatetime(m.createdAt)}</p>
                  </div>
                ))
              )}
            </div>
            {canUpdate && ticket.status !== 'CLOSED' && (
              <form
                onSubmit={handleSubmit((d) => messageMut.mutate(d))}
                className="p-5 border-t border-default space-y-3"
              >
                <div className="flex gap-2">
                  <label className="flex items-center gap-1.5 text-sm">
                    <input type="radio" value="CUSTOMER_VISIBLE" {...register('visibility')} />
                    Customer-visible reply
                  </label>
                  <label className="flex items-center gap-1.5 text-sm">
                    <input type="radio" value="INTERNAL" {...register('visibility')} />
                    Internal note
                  </label>
                </div>
                <textarea
                  {...register('body')}
                  rows={3}
                  placeholder="Write a reply or internal note…"
                  className="w-full rounded-lg border border-default bg-surface-card text-primary text-sm px-3 py-2 resize-none"
                />
                {errors.body && <p className="text-xs text-danger">{errors.body.message}</p>}
                <Button type="submit" size="sm" loading={isSubmitting || messageMut.isPending}>
                  Send
                </Button>
              </form>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-surface-card rounded-xl border border-default p-5">
            <p className="text-xs text-disabled uppercase tracking-wide mb-2">Customer</p>
            {customer ? (
              <button
                onClick={() => navigate(`/customers/${ticket.customerId}`)}
                className="text-sm font-medium text-link hover:underline"
              >
                {String(customer.displayName)}
              </button>
            ) : (
              <p className="text-sm text-secondary">—</p>
            )}
          </div>

          <div className="bg-surface-card rounded-xl border border-default p-5">
            <p className="text-xs text-disabled uppercase tracking-wide mb-2">Linked Order</p>
            {invoice ? (
              <button
                onClick={() => navigate(`/sales/invoices/${ticket.linkedInvoiceId}`)}
                className="text-sm font-medium text-link hover:underline"
              >
                #{String(invoice.invoiceNumber)} — {formatCurrency(Number(invoice.grandTotal ?? 0))}
              </button>
            ) : (
              <p className="text-sm text-secondary">No linked order — general inquiry</p>
            )}
          </div>

          {ticket.slaDueAt && (
            <div className="bg-surface-card rounded-xl border border-default p-5">
              <p className="text-xs text-disabled uppercase tracking-wide mb-1">SLA Due</p>
              <p className="text-sm font-medium text-primary">{formatDatetime(ticket.slaDueAt)}</p>
            </div>
          )}
        </div>
      </div>

      <Modal open={csatOpen} onClose={() => setCsatOpen(false)} title="Record CSAT">
        <div className="space-y-4">
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setCsatRating(n)}
                className={`w-10 h-10 rounded-lg border text-sm font-semibold ${
                  csatRating === n
                    ? 'bg-primary text-white border-primary'
                    : 'border-default text-secondary'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setCsatOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => csatMut.mutate()} disabled={csatMut.isPending}>
              Save
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
