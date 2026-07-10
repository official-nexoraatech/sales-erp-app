import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { featureFlagApi, type FeatureFlag } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';

const FLAG_DESCRIPTIONS: Record<string, string> = {
  einvoice_enabled: 'Generate NIC e-Invoices (IRN + QR code) for applicable invoices.',
  whatsapp_enabled: 'Send WhatsApp notifications for invoices, payment reminders, and CRM events.',
  fifo_valuation: 'Use FIFO costing instead of the default weighted-average cost (WACC) for inventory valuation.',
  mfa_required: 'Force all users on this tenant to enroll in two-factor authentication.',
  purchase_3way_match: 'Enforce PO / GRN / Invoice 3-way matching before a purchase invoice can be posted.',
};

export default function FeatureFlagsPage() {
  const qc = useQueryClient();
  const canUpdate = useAuthStore((s) => s.hasPermission(PERMISSIONS.FEATURE_FLAG_UPDATE));

  const { data, isLoading } = useQuery({
    queryKey: ['feature-flags'],
    queryFn: () => featureFlagApi.list(),
  });

  const flags = (data as unknown as FeatureFlag[] | undefined) ?? [];

  const toggleMutation = useMutation({
    mutationFn: ({ flagKey, enabled }: { flagKey: string; enabled: boolean }) =>
      featureFlagApi.update(flagKey, enabled),
    onSuccess: () => {
      toast.success('Feature flag updated');
      void qc.invalidateQueries({ queryKey: ['feature-flags'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <ERPPageHeader variant="list" title="Feature Flags" subtitle="Enable or disable features for this tenant." />

      <div className="card overflow-hidden">
        {isLoading ? (
          <ERPTableSkeleton rows={5} cols={3} />
        ) : (
          <div className="divide-y divide-border">
            {flags.map((flag) => (
              <div key={flag.flagKey} className="flex items-center justify-between px-4 py-4 gap-4">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-primary font-mono">{flag.flagKey}</div>
                  <div className="text-xs text-secondary mt-0.5">
                    {FLAG_DESCRIPTIONS[flag.flagKey] ?? 'No description available.'}
                  </div>
                  {flag.isOverride && (
                    <div className="text-xs text-brand mt-0.5">Tenant override active</div>
                  )}
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={flag.enabled}
                  onClick={() => toggleMutation.mutate({ flagKey: flag.flagKey, enabled: !flag.enabled })}
                  disabled={toggleMutation.isPending || !canUpdate}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                    flag.enabled ? 'bg-primary' : 'bg-surface-hover border border-default'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      flag.enabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            ))}
            {flags.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-secondary">No feature flags configured.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
