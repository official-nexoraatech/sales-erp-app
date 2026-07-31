import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { exportScheduleApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPCardSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import { formatDate } from '../../lib/format.js';

const ENTITY_TYPES = [
  'customer',
  'supplier',
  'item',
  'invoice',
  'payment',
  'ledger',
  'stock',
  'employee',
  'lead',
  'opportunity',
  'account',
  'contact',
];

interface ExportSchedule {
  id: number;
  entityType: string;
  format: 'CSV' | 'XLSX';
  cronExpression: string;
  recipients: string[];
  active: number;
  createdAt: string;
}

interface ExportRun {
  id: number;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  fileUrl: string | null;
  rowCount: number | null;
  errorMessage: string | null;
  completedAt: string | null;
}

function ScheduleHistoryPanel({ scheduleId }: { scheduleId: number }): React.ReactElement {
  const { data, isLoading } = useQuery({
    queryKey: ['export-schedule-history', scheduleId],
    queryFn: () => exportScheduleApi.history(scheduleId),
  });
  const runs = ((data as { content?: ExportRun[] })?.content ?? []) as ExportRun[];

  if (isLoading) return <p className="text-xs text-secondary px-5 py-2">Loading history…</p>;
  if (runs.length === 0) return <p className="text-xs text-secondary px-5 py-2">No runs yet.</p>;

  return (
    <div className="px-5 py-3 bg-surface-subtle space-y-2">
      {runs.map((r) => (
        <div key={r.id} className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <Badge
              label={r.status}
              color={r.status === 'COMPLETED' ? 'green' : r.status === 'FAILED' ? 'red' : 'gray'}
            />
            <span className="text-secondary">
              {r.completedAt ? formatDate(r.completedAt) : 'Running…'}
              {r.rowCount !== null ? ` · ${r.rowCount} rows` : ''}
            </span>
          </div>
          {r.fileUrl && (
            <a
              href={r.fileUrl}
              target="_blank"
              rel="noreferrer"
              className="text-brand hover:underline"
            >
              Download
            </a>
          )}
          {r.errorMessage && <span className="text-danger">{r.errorMessage}</span>}
        </div>
      ))}
    </div>
  );
}

export default function ExportSchedulesPage(): React.ReactElement {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [entityType, setEntityType] = useState('lead');
  const [format, setFormat] = useState<'CSV' | 'XLSX'>('XLSX');
  const [cronExpression, setCronExpression] = useState('0 6 * * *');
  const [recipients, setRecipients] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['export-schedules'],
    queryFn: () => exportScheduleApi.list(),
  });
  const schedules = ((data as { content?: ExportSchedule[] })?.content ?? []) as ExportSchedule[];

  const createMut = useMutation({
    mutationFn: () =>
      exportScheduleApi.create({
        entityType,
        format,
        cronExpression,
        recipients: recipients
          .split(',')
          .map((r) => r.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      toast.success('Export schedule created');
      setShowForm(false);
      setRecipients('');
      void queryClient.invalidateQueries({ queryKey: ['export-schedules'] });
    },
    onError: () => toast.error('Could not create export schedule'),
  });

  const removeMut = useMutation({
    mutationFn: (id: number) => exportScheduleApi.remove(id),
    onSuccess: () => {
      toast.success('Export schedule deactivated');
      void queryClient.invalidateQueries({ queryKey: ['export-schedules'] });
    },
    onError: () => toast.error('Could not deactivate export schedule'),
  });

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="BI Export Schedules"
        subtitle="Recurring exports of CRM and ERP data for external BI tools — dispatched on a cron, uploaded to storage, with a link emailed to recipients"
        actions={
          <Button onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : '+ New Schedule'}
          </Button>
        }
      />

      {showForm && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createMut.mutate();
          }}
          className="mb-6 space-y-3 rounded-xl border border-default bg-surface-card p-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-secondary">Entity</label>
              <select
                value={entityType}
                onChange={(e) => setEntityType(e.target.value)}
                className="mt-1 w-full rounded-md border border-default bg-surface-page px-3 py-2 text-sm"
              >
                {ENTITY_TYPES.map((et) => (
                  <option key={et} value={et}>
                    {et}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-secondary">Format</label>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as 'CSV' | 'XLSX')}
                className="mt-1 w-full rounded-md border border-default bg-surface-page px-3 py-2 text-sm"
              >
                <option value="XLSX">XLSX</option>
                <option value="CSV">CSV</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-secondary">Cron Expression</label>
            <input
              value={cronExpression}
              onChange={(e) => setCronExpression(e.target.value)}
              required
              placeholder="0 6 * * *"
              className="mt-1 w-full rounded-md border border-default bg-surface-page px-3 py-2 text-sm font-mono"
            />
          </div>
          <div>
            <label className="text-xs text-secondary">
              Recipient Emails (comma-separated, optional)
            </label>
            <input
              value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
              placeholder="analyst@example.com, bi-team@example.com"
              className="mt-1 w-full rounded-md border border-default bg-surface-page px-3 py-2 text-sm"
            />
          </div>
          <Button type="submit" disabled={createMut.isPending}>
            {createMut.isPending ? 'Creating…' : 'Create Schedule'}
          </Button>
        </form>
      )}

      <div className="bg-surface-card rounded-xl border border-default">
        <div className="px-5 py-4 border-b border-default">
          <h2 className="text-sm font-semibold text-primary">All Schedules</h2>
        </div>
        {isLoading ? (
          <div className="p-4">
            <ERPCardSkeleton lines={2} />
          </div>
        ) : schedules.length === 0 ? (
          <ERPEmptyState
            type="no-data"
            title="No export schedules yet"
            description="Create a recurring export so external BI tools always have fresh data."
            action={{ label: '+ New Schedule', onClick: () => setShowForm(true) }}
          />
        ) : (
          <div className="divide-y divide-default">
            {schedules.map((s) => (
              <div key={s.id}>
                <div className="flex items-center justify-between px-5 py-3 flex-wrap gap-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-primary capitalize">{s.entityType}</p>
                      <Badge label={s.format} color="blue" />
                      <Badge
                        label={s.active ? 'ACTIVE' : 'INACTIVE'}
                        color={s.active ? 'green' : 'gray'}
                      />
                    </div>
                    <p className="text-xs text-secondary font-mono">{s.cronExpression}</p>
                    {s.recipients.length > 0 && (
                      <p className="text-xs text-secondary">Emails: {s.recipients.join(', ')}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setExpandedId((cur) => (cur === s.id ? null : s.id))}
                    >
                      {expandedId === s.id ? 'Hide History' : 'View History'}
                    </Button>
                    {s.active === 1 && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={removeMut.isPending}
                        onClick={() => removeMut.mutate(s.id)}
                      >
                        Deactivate
                      </Button>
                    )}
                  </div>
                </div>
                {expandedId === s.id && <ScheduleHistoryPanel scheduleId={s.id} />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
