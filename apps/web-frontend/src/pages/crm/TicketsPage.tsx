import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Eye } from 'lucide-react';
import { ticketApi } from '../../api/endpoints.js';
import { useUrlParams } from '../../hooks/useUrlParam.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import ERPDataGrid, {
  type ERPColumnDef,
  type ERPRowAction,
} from '../../components/erp/ERPDataGrid.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Select from '../../components/ui/Select.js';
import type { TICKET_STATUSES } from '../../schemas/ticket.schema.js';

const URL_DEFAULTS = { status: '' };

interface Ticket {
  id: number;
  ticketNumber: string;
  subject: string;
  status: (typeof TICKET_STATUSES)[number];
  priority: string;
  slaDueAt?: string;
  slaBreached: boolean;
  assignedTo?: number;
}

const STATUS_COLOR: Record<string, 'blue' | 'yellow' | 'green' | 'gray'> = {
  OPEN: 'blue',
  IN_PROGRESS: 'yellow',
  WAITING_ON_CUSTOMER: 'yellow',
  RESOLVED: 'green',
  CLOSED: 'gray',
};

function SlaChip({ ticket }: { ticket: Ticket }) {
  if (!ticket.slaDueAt || ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') {
    return <span className="text-xs text-disabled">—</span>;
  }
  if (ticket.slaBreached) {
    return <Badge label="SLA BREACHED" color="red" />;
  }
  const msLeft = new Date(ticket.slaDueAt).getTime() - Date.now();
  const hoursLeft = Math.round(msLeft / (60 * 60 * 1000));
  if (hoursLeft <= 0) return <Badge label="SLA BREACHED" color="red" />;
  if (hoursLeft <= 4) return <Badge label={`${hoursLeft}h left`} color="yellow" />;
  return <Badge label={`${hoursLeft}h left`} color="gray" />;
}

export default function TicketsPage() {
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreate = hasPermission(PERMISSIONS.TICKET_CREATE);
  const [urlState, setUrlState] = useUrlParams(URL_DEFAULTS);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['tickets', urlState.status],
    queryFn: () => ticketApi.list({ status: urlState.status || undefined }),
  });
  const tickets: Ticket[] = ((data as Record<string, unknown>)?.content as Ticket[]) ?? [];

  const columns: ERPColumnDef<Ticket>[] = [
    {
      key: 'ticketNumber',
      header: 'Ticket',
      render: (r) => (
        <button
          onClick={() => navigate(`/crm/tickets/${r.id}`)}
          className="font-medium text-link hover:underline"
        >
          {r.ticketNumber}
        </button>
      ),
    },
    { key: 'subject', header: 'Subject' },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <Badge label={r.status.replace(/_/g, ' ')} color={STATUS_COLOR[r.status] ?? 'gray'} />
      ),
    },
    {
      key: 'priority',
      header: 'Priority',
      render: (r) => <Badge label={r.priority} color="blue" />,
    },
    { key: 'slaDueAt', header: 'SLA', render: (r) => <SlaChip ticket={r} /> },
  ];

  const rowActions: ERPRowAction<Ticket>[] = [
    { icon: Eye, label: 'View', type: 'view', onClick: (r) => navigate(`/crm/tickets/${r.id}`) },
  ];

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Tickets"
        subtitle="Support tickets with SLA tracking, replacing untracked complaint interactions."
        actions={
          canCreate ? (
            <Button onClick={() => navigate('/crm/tickets/new')}>+ New Ticket</Button>
          ) : undefined
        }
      />

      <div className="flex gap-3 mb-4">
        <Select
          aria-label="Filter by status"
          value={urlState.status}
          onChange={(e) => setUrlState({ status: e.target.value })}
          className="w-48"
        >
          <option value="">All Statuses</option>
          <option value="OPEN">Open</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="WAITING_ON_CUSTOMER">Waiting on Customer</option>
          <option value="RESOLVED">Resolved</option>
          <option value="CLOSED">Closed</option>
        </Select>
      </div>

      {isError ? (
        <ERPEmptyState type="error" />
      ) : tickets.length === 0 && !isLoading ? (
        <ERPEmptyState
          type="no-data"
          title="No tickets yet"
          description="Support tickets created manually or via other channels will appear here."
          {...(canCreate
            ? { action: { label: '+ New Ticket', onClick: () => navigate('/crm/tickets/new') } }
            : {})}
        />
      ) : (
        <ERPDataGrid
          columns={columns}
          data={tickets}
          isLoading={isLoading}
          rowKey="id"
          tableId="crm-tickets"
          actions={rowActions}
        />
      )}
    </div>
  );
}
