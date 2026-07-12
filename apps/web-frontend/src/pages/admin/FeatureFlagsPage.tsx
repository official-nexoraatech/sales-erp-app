import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { featureFlagApi, type FeatureFlag } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPSelect from '../../components/erp/ERPSelect.js';
import Button from '../../components/ui/Button.js';

const FLAG_DESCRIPTIONS: Record<string, string> = {
  einvoice_enabled: 'Generate NIC e-Invoices (IRN + QR code) for applicable invoices.',
  whatsapp_enabled: 'Send WhatsApp notifications for invoices, payment reminders, and CRM events.',
  fifo_valuation:
    'Use FIFO costing instead of the default weighted-average cost (WACC) for inventory valuation.',
  mfa_required: 'Force all users on this tenant to enroll in two-factor authentication.',
  purchase_3way_match:
    'Enforce PO / GRN / Invoice 3-way matching before a purchase invoice can be posted.',
};

// PG-047: this flag's config carries a quiet-hours window instead of a plain on/off — rendered
// with a dedicated hour-picker control below rather than the generic enabled/disabled switch.
const QUIET_HOURS_FLAG_KEY = 'notification_quiet_hours';
const DEFAULT_QUIET_HOURS_START = 22;
const DEFAULT_QUIET_HOURS_END = 8;

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({
  value: h,
  label: `${String(h).padStart(2, '0')}:00`,
}));

function QuietHoursCard({
  flag,
  canUpdate,
  onSave,
  isSaving,
}: {
  flag: FeatureFlag | undefined;
  canUpdate: boolean;
  onSave: (startHour: number, endHour: number) => void;
  isSaving: boolean;
}) {
  const config = (flag?.config ?? {}) as { startHour?: number; endHour?: number };
  const [startHour, setStartHour] = useState(config.startHour ?? DEFAULT_QUIET_HOURS_START);
  const [endHour, setEndHour] = useState(config.endHour ?? DEFAULT_QUIET_HOURS_END);

  return (
    <div className="card px-4 py-4 space-y-3">
      <div>
        <div className="text-sm font-medium text-primary font-mono">{QUIET_HOURS_FLAG_KEY}</div>
        <div className="text-xs text-secondary mt-0.5">
          SMS notifications are suppressed during this window (IST). Defaults to 22:00–08:00 until
          configured.
        </div>
      </div>
      <div className="flex items-center gap-3">
        <label className="text-xs text-secondary">
          Start
          <ERPSelect
            className="mt-1"
            options={HOUR_OPTIONS}
            value={startHour}
            disabled={!canUpdate || isSaving}
            onChange={(e) => setStartHour(Number(e.target.value))}
          />
        </label>
        <label className="text-xs text-secondary">
          End
          <ERPSelect
            className="mt-1"
            options={HOUR_OPTIONS}
            value={endHour}
            disabled={!canUpdate || isSaving}
            onChange={(e) => setEndHour(Number(e.target.value))}
          />
        </label>
        <Button
          type="button"
          size="sm"
          className="mt-4"
          onClick={() => onSave(startHour, endHour)}
          disabled={!canUpdate}
          loading={isSaving}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

export default function FeatureFlagsPage() {
  const qc = useQueryClient();
  const canUpdate = useAuthStore((s) => s.hasPermission(PERMISSIONS.FEATURE_FLAG_UPDATE));

  const { data, isLoading } = useQuery({
    queryKey: ['feature-flags'],
    queryFn: () => featureFlagApi.list(),
  });

  const flags = (data as unknown as FeatureFlag[] | undefined) ?? [];
  const otherFlags = flags.filter((f) => f.flagKey !== QUIET_HOURS_FLAG_KEY);
  const quietHoursFlag = flags.find((f) => f.flagKey === QUIET_HOURS_FLAG_KEY);

  const toggleMutation = useMutation({
    mutationFn: ({ flagKey, enabled }: { flagKey: string; enabled: boolean }) =>
      featureFlagApi.update(flagKey, enabled),
    onSuccess: () => {
      toast.success('Feature flag updated');
      void qc.invalidateQueries({ queryKey: ['feature-flags'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const quietHoursMutation = useMutation({
    mutationFn: ({ startHour, endHour }: { startHour: number; endHour: number }) =>
      featureFlagApi.update(QUIET_HOURS_FLAG_KEY, true, { startHour, endHour }),
    onSuccess: () => {
      toast.success('Quiet hours updated');
      void qc.invalidateQueries({ queryKey: ['feature-flags'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <ERPPageHeader
        variant="list"
        title="Feature Flags"
        subtitle="Enable or disable features for this tenant."
      />

      {isLoading ? (
        <div className="card px-4 py-4">
          <ERPTableSkeleton rows={1} cols={3} />
        </div>
      ) : (
        <QuietHoursCard
          flag={quietHoursFlag}
          canUpdate={canUpdate}
          isSaving={quietHoursMutation.isPending}
          onSave={(startHour, endHour) => quietHoursMutation.mutate({ startHour, endHour })}
        />
      )}

      <div className="card overflow-hidden">
        {isLoading ? (
          <ERPTableSkeleton rows={5} cols={3} />
        ) : (
          <div className="divide-y divide-border">
            {otherFlags.map((flag) => (
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
                  onClick={() =>
                    toggleMutation.mutate({ flagKey: flag.flagKey, enabled: !flag.enabled })
                  }
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
            {otherFlags.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-secondary">
                No feature flags configured.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
