import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { crmApi } from '../../api/endpoints.js';
import { useConfirm } from '../../context/ConfirmContext.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import { formatDatetime } from '../../lib/format.js';

interface Journey {
  id: number;
  name: string;
  status: 'DRAFT' | 'PUBLISHED' | 'PAUSED' | 'ARCHIVED';
  segmentId: number | null;
  publishedAt: string | null;
  createdAt: string;
}

const STATUS_COLORS: Record<string, 'green' | 'yellow' | 'red' | 'blue' | 'gray'> = {
  DRAFT: 'gray',
  PUBLISHED: 'green',
  PAUSED: 'yellow',
  ARCHIVED: 'red',
};

const LIST_PATH = '/crm/journeys';

export default function JourneysPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreate = hasPermission(PERMISSIONS.JOURNEY_CREATE);
  const canDelete = hasPermission(PERMISSIONS.JOURNEY_DELETE);

  const { data, isLoading } = useQuery({
    queryKey: ['journeys'],
    queryFn: () => crmApi.listJourneys(),
  });
  const journeys: Journey[] = (data as { content?: Journey[] })?.content ?? [];

  const deleteMut = useMutation({
    mutationFn: (id: number) => crmApi.deleteJourney(id),
    onSuccess: () => {
      toast.success('Journey removed');
      qc.invalidateQueries({ queryKey: ['journeys'] });
    },
    onError: () => toast.error('Failed to remove journey'),
  });

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Customer Journeys"
        subtitle="Multi-step, branching, cross-channel automation sequences"
        actions={
          canCreate ? (
            <Button onClick={() => navigate('/crm/journeys/new')}>+ New Journey</Button>
          ) : undefined
        }
      />

      <div className="bg-surface-card rounded-xl border border-default">
        {isLoading ? (
          <ERPTableSkeleton rows={6} cols={4} />
        ) : journeys.length === 0 ? (
          <ERPEmptyState
            type="no-data"
            title="No journeys yet"
            description="Build a multi-step, branching automation sequence — welcome messages, follow-ups, conditional offers."
            {...(canCreate
              ? { action: { label: '+ New Journey', onClick: () => navigate('/crm/journeys/new') } }
              : {})}
          />
        ) : (
          <div className="divide-y divide-default">
            {journeys.map((j) => (
              <div key={j.id} className="flex items-center gap-4 px-5 py-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-primary truncate">{j.name}</p>
                    <Badge label={j.status} color={STATUS_COLORS[j.status] ?? 'gray'} />
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-xs text-secondary">
                    {j.publishedAt ? (
                      <span>Published: {formatDatetime(j.publishedAt)}</span>
                    ) : (
                      <span>Created: {formatDatetime(j.createdAt)}</span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => navigate(`/crm/journeys/${j.id}`)}
                  >
                    View
                  </Button>
                  {canDelete && j.status !== 'ARCHIVED' && (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={async () => {
                        const ok = await confirm({
                          title: j.status === 'DRAFT' ? 'Delete Journey' : 'Archive Journey',
                          message:
                            j.status === 'DRAFT'
                              ? `Delete "${j.name}"? This can't be undone.`
                              : `Archive "${j.name}"? Existing enrollments stop being evaluated but their history is kept.`,
                          confirmLabel: j.status === 'DRAFT' ? 'Delete' : 'Archive',
                          variant: 'danger',
                        });
                        if (ok) deleteMut.mutate(j.id);
                      }}
                      disabled={deleteMut.isPending}
                    >
                      {j.status === 'DRAFT' ? 'Delete' : 'Archive'}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export { LIST_PATH };
