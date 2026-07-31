import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ticketApi, customerApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPFormSection from '../../components/erp/ERPFormSection.js';
import ERPStickyFooter from '../../components/erp/ERPStickyFooter.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import Button from '../../components/ui/Button.js';
import {
  ticketFormSchema,
  TICKET_TYPES,
  TICKET_PRIORITIES,
  type TicketFormData,
} from '../../schemas/ticket.schema.js';

export default function TicketFormPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  // Entry point per the Phase 1 spec's Playwright scenario: "Create a ticket manually from
  // Customer 360" — customerId arrives pre-filled via query param from that page's quick
  // action, rather than requiring a separate customer-search UI on this form.
  const prefilledCustomerId = searchParams.get('customerId');

  const { data: customerData } = useQuery({
    queryKey: ['customers', prefilledCustomerId],
    queryFn: () => customerApi.getById(Number(prefilledCustomerId)),
    enabled: !!prefilledCustomerId,
  });
  const customer = customerData as Record<string, unknown> | undefined;

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TicketFormData>({
    resolver: zodResolver(ticketFormSchema),
    ...(prefilledCustomerId ? { defaultValues: { customerId: Number(prefilledCustomerId) } } : {}),
  });

  const mutation = useMutation({
    mutationFn: (d: Record<string, unknown>) => ticketApi.create(d),
    onSuccess: (created) => {
      toast.success('Ticket created');
      qc.invalidateQueries({ queryKey: ['tickets'] });
      const ticket = created as Record<string, unknown>;
      navigate(`/crm/tickets/${ticket.id}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div>
      <ERPPageHeader variant="detail" title="New Ticket" backTo="/crm/tickets" />

      <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-6" noValidate>
        <ERPFormSection title="Ticket Details" columns={2}>
          {prefilledCustomerId && customer ? (
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-secondary mb-1.5">Customer</label>
              <p className="text-sm font-medium text-primary">{String(customer.displayName)}</p>
              <input type="hidden" {...register('customerId')} value={prefilledCustomerId} />
            </div>
          ) : (
            <Input
              label="Customer ID"
              type="number"
              required
              {...register('customerId')}
              error={errors.customerId?.message}
            />
          )}
          <Input
            label="Subject"
            required
            {...register('subject')}
            error={errors.subject?.message}
          />
          <Select label="Type" {...register('ticketType')} error={errors.ticketType?.message}>
            {TICKET_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
          <Select label="Priority" {...register('priority')} error={errors.priority?.message}>
            {TICKET_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </ERPFormSection>

        <ERPFormSection title="Description" columns={1}>
          <div className="sm:col-span-2">
            <textarea
              {...register('description')}
              rows={4}
              placeholder="What's the issue or inquiry?"
              className="w-full rounded-lg border border-default bg-surface-card text-primary text-sm px-3 py-2 resize-none"
            />
          </div>
        </ERPFormSection>

        <ERPStickyFooter>
          <Button variant="secondary" type="button" onClick={() => navigate('/crm/tickets')}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting || mutation.isPending}>
            Create Ticket
          </Button>
        </ERPStickyFooter>
      </form>
    </div>
  );
}
