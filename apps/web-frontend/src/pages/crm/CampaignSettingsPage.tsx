import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { crmApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPFormSkeleton } from '../../components/erp/ERPSkeleton.js';
import Button from '../../components/ui/Button.js';
import Checkbox from '../../components/ui/Checkbox.js';
import Input from '../../components/ui/Input.js';

interface CommunicationSettings {
  approvalRequired: boolean;
  maxPerDayFrequencyCap: number | null;
}

export default function CampaignSettingsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['crm-communication-settings'],
    queryFn: () => crmApi.getCommunicationSettings(),
  });
  const settings = data as CommunicationSettings | undefined;

  const [approvalRequired, setApprovalRequired] = useState(false);
  const [frequencyCap, setFrequencyCap] = useState('');

  useEffect(() => {
    if (!settings) return;
    setApprovalRequired(settings.approvalRequired);
    setFrequencyCap(
      settings.maxPerDayFrequencyCap != null ? String(settings.maxPerDayFrequencyCap) : ''
    );
  }, [settings]);

  const saveMut = useMutation({
    mutationFn: () =>
      crmApi.updateCommunicationSettings({
        approvalRequired,
        maxPerDayFrequencyCap: frequencyCap ? Number(frequencyCap) : null,
      }),
    onSuccess: () => toast.success('Campaign settings saved'),
    onError: () => toast.error('Failed to save campaign settings'),
  });

  if (isLoading) return <ERPFormSkeleton />;

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Campaign Settings"
        subtitle="Tenant-wide rules applied to every campaign"
      />

      <div className="bg-surface-card rounded-xl border border-default p-5 space-y-6 max-w-xl">
        <div>
          <Checkbox
            checked={approvalRequired}
            onChange={(e) => setApprovalRequired(e.target.checked)}
            label="Require approval before a campaign can be scheduled or sent"
            description="When enabled, a campaign must move through Submit for Approval → Approved by someone holding the Approve Campaigns permission before it can be scheduled or sent. When disabled (the default), Submit for Approval auto-approves immediately — today's behavior."
          />
        </div>

        <div>
          <Input
            label="Maximum messages per customer per day (optional)"
            type="number"
            min={1}
            value={frequencyCap}
            onChange={(e) => setFrequencyCap(e.target.value)}
            placeholder="No limit"
          />
          <p className="text-xs text-secondary mt-1.5">
            Applies across every campaign combined — a customer who already received this many
            messages today from any campaign is skipped, not just capped per-campaign. Leave blank
            for no limit.
          </p>
        </div>

        <div className="flex justify-end pt-2">
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
            {saveMut.isPending ? 'Saving…' : 'Save Settings'}
          </Button>
        </div>
      </div>
    </div>
  );
}
