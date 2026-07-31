import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { leadApi, branchApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPDetailSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Modal from '../../components/ui/Modal.js';
import Select from '../../components/ui/Select.js';
import { formatDatetime } from '../../lib/format.js';
import type { LEAD_STAGES } from '../../schemas/lead.schema.js';

interface Lead {
  id: number;
  displayName?: string;
  companyName?: string;
  phone: string;
  email?: string;
  source: string;
  stage: (typeof LEAD_STAGES)[number];
  isB2b: boolean;
  assignedTo?: number;
  convertedCustomerId?: number;
  notes?: string;
  version: number;
}

interface Activity {
  id: number;
  activityType: string;
  description?: string;
  fromStage?: string;
  toStage?: string;
  createdAt: string;
}

const STAGE_COLOR: Record<string, 'blue' | 'yellow' | 'green' | 'red' | 'gray'> = {
  NEW: 'blue',
  CONTACTED: 'yellow',
  QUALIFIED: 'blue',
  CONVERTED: 'green',
  LOST: 'red',
};

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const leadId = Number(id);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canConvert = hasPermission(PERMISSIONS.LEAD_CONVERT);
  const canAssign = hasPermission(PERMISSIONS.LEAD_ASSIGN);

  const [convertOpen, setConvertOpen] = useState(false);
  const [branchId, setBranchId] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['leads', id],
    queryFn: () => leadApi.getById(leadId),
  });
  const lead = data as Lead | undefined;

  const { data: activitiesData } = useQuery({
    queryKey: ['lead-activities', id],
    queryFn: () => leadApi.listActivities(leadId),
  });
  const activities: Activity[] = (activitiesData as { content?: Activity[] })?.content ?? [];

  const { data: branchData } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchApi.list(),
    enabled: convertOpen,
  });
  const branches = (branchData as { content?: { id: number; name: string }[] })?.content ?? [];

  const assignMutation = useMutation({
    mutationFn: () => leadApi.assign(leadId),
    onSuccess: () => {
      toast.success('Lead assigned');
      qc.invalidateQueries({ queryKey: ['leads', id] });
      qc.invalidateQueries({ queryKey: ['lead-activities', id] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const convertMutation = useMutation({
    mutationFn: () => leadApi.convert(leadId, Number(branchId)),
    onSuccess: (result) => {
      toast.success('Lead converted to customer');
      const customerId = (result as { customer?: { id: number } })?.customer?.id;
      setConvertOpen(false);
      if (customerId) navigate(`/customers/${customerId}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) return <ERPDetailSkeleton />;
  if (!lead) return <ERPEmptyState type="no-data" title="Lead not found" />;

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title={lead.displayName || lead.companyName || lead.phone}
        subtitle={`Source: ${lead.source.replace(/_/g, ' ')}`}
        actions={
          <div className="flex gap-2 flex-wrap">
            {canAssign && lead.stage !== 'CONVERTED' && (
              <Button
                variant="secondary"
                onClick={() => assignMutation.mutate()}
                disabled={assignMutation.isPending}
              >
                Auto-Assign
              </Button>
            )}
            {canConvert && lead.stage !== 'CONVERTED' && (
              <Button onClick={() => setConvertOpen(true)}>Convert to Customer</Button>
            )}
            <Button variant="secondary" onClick={() => navigate('/crm/leads')}>
              Back
            </Button>
          </div>
        }
      />

      <div className="mb-4">
        <Badge label={lead.stage} color={STAGE_COLOR[lead.stage] ?? 'gray'} />
        {lead.isB2b && <Badge label="B2B" color="blue" />}
        {lead.convertedCustomerId && (
          <button
            onClick={() => navigate(`/customers/${lead.convertedCustomerId}`)}
            className="ml-2 text-sm text-link hover:underline"
          >
            View converted customer →
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-surface-card rounded-xl border border-default p-5">
            <h2 className="text-sm font-semibold text-secondary mb-4 uppercase tracking-wide">
              Details
            </h2>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { label: 'Phone', value: lead.phone },
                { label: 'Email', value: lead.email },
                { label: 'Company', value: lead.companyName },
              ].map(({ label, value }) => (
                <div key={label}>
                  <dt className="text-xs text-disabled">{label}</dt>
                  <dd className="text-sm text-primary font-medium">{value ?? '–'}</dd>
                </div>
              ))}
            </dl>
            {lead.notes && <p className="text-sm text-secondary mt-4">{lead.notes}</p>}
          </div>

          <div className="bg-surface-card rounded-xl border border-default">
            <div className="px-5 py-4 border-b border-default">
              <h2 className="text-sm font-semibold text-secondary uppercase tracking-wide">
                Activity
              </h2>
            </div>
            {activities.length === 0 ? (
              <ERPEmptyState type="no-data" title="No activity yet" />
            ) : (
              <div className="divide-y divide-default">
                {activities.map((a) => (
                  <div key={a.id} className="px-5 py-3">
                    <p className="text-sm text-primary">
                      {a.activityType === 'STAGE_CHANGE'
                        ? `Stage changed: ${a.fromStage} → ${a.toStage}`
                        : a.description}
                    </p>
                    <p className="text-xs text-secondary mt-0.5">{formatDatetime(a.createdAt)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <Modal
        open={convertOpen}
        onClose={() => setConvertOpen(false)}
        title="Convert Lead to Customer"
      >
        <div className="space-y-4">
          <Select
            label="Branch"
            required
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
          >
            <option value="">Select branch…</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="ghost" onClick={() => setConvertOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => convertMutation.mutate()}
              disabled={!branchId || convertMutation.isPending}
            >
              {convertMutation.isPending ? 'Converting…' : 'Convert'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
