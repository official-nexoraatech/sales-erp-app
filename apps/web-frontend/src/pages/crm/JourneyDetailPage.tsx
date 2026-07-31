import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { crmApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { useConfirm } from '../../context/ConfirmContext.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPFormSkeleton } from '../../components/erp/ERPSkeleton.js';
import Badge from '../../components/ui/Badge.js';
import Button from '../../components/ui/Button.js';
import Input from '../../components/ui/Input.js';
import { formatDatetime } from '../../lib/format.js';

interface JourneyStep {
  id: number;
  parentStepId: number | null;
  branchPath: 'TRUE' | 'FALSE' | null;
  sequence: number;
  stepType: 'DELAY' | 'ACTION' | 'BRANCH';
  delayDays: number | null;
  channel: string | null;
  messageTemplate: string | null;
  branchConditionType: string | null;
  branchWithinDays: number | null;
  truePath?: JourneyStep[];
  falsePath?: JourneyStep[];
}

interface JourneyDetail {
  id: number;
  name: string;
  status: 'DRAFT' | 'PUBLISHED' | 'PAUSED' | 'ARCHIVED';
  segmentId: number | null;
  publishedAt: string | null;
  createdAt: string;
  steps: JourneyStep[];
  funnel: Array<{ stepId: number; entered: number; completed: number; exited: number }>;
}

interface Enrollment {
  id: number;
  customerId: number;
  status: 'ACTIVE' | 'COMPLETED' | 'EXITED';
  exitReason: string | null;
  enrolledAt: string;
  completedAt: string | null;
  exitedAt: string | null;
}

const STATUS_COLORS: Record<string, 'green' | 'yellow' | 'red' | 'blue' | 'gray'> = {
  DRAFT: 'gray',
  PUBLISHED: 'green',
  PAUSED: 'yellow',
  ARCHIVED: 'red',
  ACTIVE: 'blue',
  COMPLETED: 'green',
  EXITED: 'gray',
};

function StepView({ step, funnel }: { step: JourneyStep; funnel: JourneyDetail['funnel'] }) {
  const stats = funnel.find((f) => f.stepId === step.id);
  return (
    <div className="rounded-lg border border-default p-3 bg-surface-card space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-secondary">Step {step.sequence}</span>
        <Badge label={step.stepType} color="blue" />
        {stats && (
          <span className="text-xs text-secondary">
            {stats.entered} entered · {stats.completed} completed · {stats.exited} exited
          </span>
        )}
      </div>
      {step.stepType === 'DELAY' && (
        <p className="text-sm text-primary">Wait {step.delayDays} day(s)</p>
      )}
      {step.stepType === 'ACTION' && (
        <p className="text-sm text-primary">
          Send via {step.channel}: <span className="text-secondary">{step.messageTemplate}</span>
        </p>
      )}
      {step.stepType === 'BRANCH' && (
        <>
          <p className="text-sm text-primary">
            Made a purchase within {step.branchWithinDays} day(s)?
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
            <div>
              <p className="text-xs font-semibold text-success mb-1">If TRUE</p>
              <div className="space-y-2">
                {(step.truePath ?? []).map((s) => (
                  <StepView key={s.id} step={s} funnel={funnel} />
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-danger mb-1">If FALSE</p>
              <div className="space-y-2">
                {(step.falsePath ?? []).map((s) => (
                  <StepView key={s.id} step={s} funnel={funnel} />
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const LIST_PATH = '/crm/journeys';

export default function JourneyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canPublish = hasPermission(PERMISSIONS.JOURNEY_PUBLISH);
  const canCreate = hasPermission(PERMISSIONS.JOURNEY_CREATE);
  const canDelete = hasPermission(PERMISSIONS.JOURNEY_DELETE);
  const [enrollCustomerId, setEnrollCustomerId] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['journey', id],
    queryFn: () => crmApi.getJourney(Number(id)),
  });
  const journey = data as JourneyDetail | undefined;

  const { data: enrollmentsData } = useQuery({
    queryKey: ['journey-enrollments', id],
    queryFn: () => crmApi.listJourneyEnrollments(Number(id)),
  });
  const enrollments: Enrollment[] = (enrollmentsData as { content?: Enrollment[] })?.content ?? [];

  // Preview-affected-count safeguard — checked before publish, not just after (roadmap's own
  // explicit rollback/risk requirement), so this is fetched as soon as the journey loads.
  const { data: affectedData } = useQuery({
    queryKey: ['journey-affected-count', id],
    queryFn: () => crmApi.journeyAffectedCount(Number(id)),
    enabled: !!journey?.segmentId,
  });
  const affectedCount = (affectedData as { count?: number | null })?.count;

  const publishMut = useMutation({
    mutationFn: () => crmApi.publishJourney(Number(id)),
    onSuccess: () => {
      toast.success('Journey published');
      qc.invalidateQueries({ queryKey: ['journey', id] });
      qc.invalidateQueries({ queryKey: ['journeys'] });
    },
    onError: () => toast.error('Failed to publish journey'),
  });

  const deleteMut = useMutation({
    mutationFn: () => crmApi.deleteJourney(Number(id)),
    onSuccess: () => {
      toast.success(journey?.status === 'DRAFT' ? 'Journey deleted' : 'Journey archived');
      navigate(LIST_PATH);
    },
    onError: () => toast.error('Failed to remove journey'),
  });

  const enrollMut = useMutation({
    mutationFn: () => crmApi.enrollJourneyCustomer(Number(id), Number(enrollCustomerId)),
    onSuccess: () => {
      toast.success('Customer enrolled');
      setEnrollCustomerId('');
      qc.invalidateQueries({ queryKey: ['journey-enrollments', id] });
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to enroll customer'),
  });

  if (isLoading || !journey) return <ERPFormSkeleton />;

  const topLevelSteps = journey.steps ?? [];

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title={journey.name}
        subtitle={`Customer journey — ${journey.status}`}
        backTo={LIST_PATH}
        actions={
          <div className="flex gap-2">
            {canPublish && journey.status === 'DRAFT' && (
              <Button
                onClick={async () => {
                  const ok = await confirm({
                    title: 'Publish Journey',
                    message: journey.segmentId
                      ? `This will enroll ${affectedCount ?? 'all matching'} customer(s) currently in the target segment and any new matches going forward. This can't be undone.`
                      : 'This journey has no target segment — customers can only be enrolled manually. Publish it?',
                    confirmLabel: 'Publish',
                  });
                  if (ok) publishMut.mutate();
                }}
                disabled={publishMut.isPending}
              >
                Publish
              </Button>
            )}
            {canDelete && journey.status !== 'ARCHIVED' && (
              <Button
                variant="danger"
                onClick={async () => {
                  const ok = await confirm({
                    title: journey.status === 'DRAFT' ? 'Delete Journey' : 'Archive Journey',
                    message:
                      journey.status === 'DRAFT'
                        ? `Delete "${journey.name}"? This can't be undone.`
                        : `Archive "${journey.name}"? Existing enrollments stop being evaluated but their history is kept.`,
                    confirmLabel: journey.status === 'DRAFT' ? 'Delete' : 'Archive',
                    variant: 'danger',
                  });
                  if (ok) deleteMut.mutate();
                }}
                disabled={deleteMut.isPending}
              >
                {journey.status === 'DRAFT' ? 'Delete' : 'Archive'}
              </Button>
            )}
          </div>
        }
      />

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Badge label={journey.status} color={STATUS_COLORS[journey.status] ?? 'gray'} />
        {journey.segmentId && (
          <span className="text-xs text-secondary">
            Target segment #{journey.segmentId}
            {affectedCount != null && ` — ${affectedCount} customer(s) matching now`}
          </span>
        )}
        {journey.publishedAt && (
          <span className="text-xs text-secondary">
            Published {formatDatetime(journey.publishedAt)}
          </span>
        )}
      </div>

      <div className="bg-surface-card rounded-xl border border-default p-4 mb-4">
        <p className="text-sm font-semibold text-primary mb-3">Steps</p>
        <div className="space-y-3">
          {topLevelSteps.map((s) => (
            <StepView key={s.id} step={s} funnel={journey.funnel ?? []} />
          ))}
        </div>
      </div>

      {canCreate && journey.status === 'PUBLISHED' && (
        <div className="bg-surface-card rounded-xl border border-default p-4 mb-4">
          <p className="text-sm font-semibold text-primary mb-3">Enroll a Customer Manually</p>
          <div className="flex gap-2 items-end flex-wrap">
            <Input
              label="Customer ID"
              type="number"
              value={enrollCustomerId}
              onChange={(e) => setEnrollCustomerId(e.target.value)}
              className="w-40"
            />
            <Button
              onClick={() => enrollMut.mutate()}
              disabled={enrollMut.isPending || !enrollCustomerId}
            >
              Enroll
            </Button>
          </div>
        </div>
      )}

      <div className="bg-surface-card rounded-xl border border-default">
        <p className="text-sm font-semibold text-primary p-4 pb-0">Enrollments</p>
        {enrollments.length === 0 ? (
          <p className="text-xs text-secondary p-4">No enrollments yet.</p>
        ) : (
          <div className="divide-y divide-default">
            {enrollments.map((e) => (
              <div key={e.id} className="flex items-center gap-4 px-4 py-3 flex-wrap">
                <span className="text-sm text-primary">Customer #{e.customerId}</span>
                <Badge label={e.status} color={STATUS_COLORS[e.status] ?? 'gray'} />
                {e.exitReason && <span className="text-xs text-secondary">({e.exitReason})</span>}
                <span className="text-xs text-secondary">
                  Enrolled {formatDatetime(e.enrolledAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
