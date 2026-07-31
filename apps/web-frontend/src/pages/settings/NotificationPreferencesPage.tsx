import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Switch } from '@erp/ui';
import { notificationsApi, type NotificationPreference } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPFormSkeleton } from '../../components/erp/ERPSkeleton.js';

// Curated set of internal-staff notification categories this ERP actually dispatches today
// (see the notification-service audit, 2026-07-23 — every eventType below is a real,
// currently-firing scheduler alert or workflow event). Customer-facing sends (CRM campaigns,
// invoice/payment reminders to customers) are not preference-gated — they go directly to the
// customer's phone/email, not through a staff user's notification_preferences row.
const CATEGORIES: Array<{ eventType: string; label: string; description: string }> = [
  {
    eventType: 'WORKFLOW_APPROVAL_REMINDER',
    label: 'Approval Reminders',
    description: 'Twice-daily reminders for approvals waiting on you.',
  },
  {
    eventType: 'PO_DELIVERY_REMINDER',
    label: 'Purchase Order Delivery Reminders',
    description: 'Daily reminder for POs overdue for delivery.',
  },
  {
    eventType: 'PENDING_GRN_ALERT',
    label: 'Pending GRN Alerts',
    description: 'GRNs stuck in Draft/Pending Approval beyond the configured window.',
  },
  {
    eventType: 'REORDER_REPORT',
    label: 'Low Stock / Reorder Alerts',
    description: 'Daily report of items below their reorder level.',
  },
  {
    eventType: 'JOB_WORK_OVERDUE_ALERT',
    label: 'Job Work Overdue Alerts',
    description: 'Daily check of in-progress job-work orders.',
  },
  {
    eventType: 'PDC_CLEARING_ALERT',
    label: 'Post-Dated Cheque Alerts',
    description: 'Warns 3 days before a PDC is due to clear.',
  },
  {
    eventType: 'GSTR3B_FILING_REMINDER',
    label: 'GSTR-3B Filing Reminders',
    description: 'Monthly reminder to file GSTR-3B by the 20th.',
  },
  {
    eventType: 'EWAY_BILL_EXPIRY_ALERT',
    label: 'e-Way Bill Expiry Alerts',
    description: 'Daily check for e-Way Bills expiring within 24 hours.',
  },
];

// Matches notification_preferences' own column defaults (see packages/db-client/src/schema/
// notification.ts and the POST /notifications/preferences route) — used when no row exists yet
// for a category, i.e. the user has never touched it.
const DEFAULT_PREFERENCE: Omit<NotificationPreference, 'eventType'> = {
  smsEnabled: true,
  emailEnabled: true,
  whatsappEnabled: false,
  inAppEnabled: true,
  quietHoursEnabled: true,
};

type ChannelKey = 'smsEnabled' | 'emailEnabled' | 'whatsappEnabled' | 'inAppEnabled';

const CHANNEL_COLUMNS: Array<{ key: ChannelKey; label: string }> = [
  { key: 'emailEnabled', label: 'Email' },
  { key: 'smsEnabled', label: 'SMS' },
  { key: 'whatsappEnabled', label: 'WhatsApp' },
  { key: 'inAppEnabled', label: 'In-App' },
];

export default function NotificationPreferencesPage() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: () => notificationsApi.getPreferences(),
  });

  const saved = (data as unknown as { content: NotificationPreference[] } | undefined)?.content;

  const saveMutation = useMutation({
    mutationFn: (pref: NotificationPreference) => notificationsApi.savePreference(pref),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notification-preferences'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function prefFor(eventType: string): NotificationPreference {
    return saved?.find((p) => p.eventType === eventType) ?? { eventType, ...DEFAULT_PREFERENCE };
  }

  function toggle(eventType: string, key: ChannelKey | 'quietHoursEnabled', value: boolean): void {
    saveMutation.mutate({ ...prefFor(eventType), [key]: value });
  }

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Notification Preferences"
        subtitle="Choose which channels you're notified on for each alert category, and whether quiet hours (10 PM–8 AM IST) apply."
      />

      {isLoading ? (
        <div className="mt-6">
          <ERPFormSkeleton />
        </div>
      ) : (
        <div className="card p-6 mt-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-secondary text-xs uppercase">
                <th className="py-2 pr-4">Category</th>
                {CHANNEL_COLUMNS.map((c) => (
                  <th key={c.key} className="py-2 px-4 text-center">
                    {c.label}
                  </th>
                ))}
                <th className="py-2 pl-4 text-center">Quiet Hours</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-default">
              {CATEGORIES.map((cat) => {
                const pref = prefFor(cat.eventType);
                return (
                  <tr key={cat.eventType}>
                    <td className="py-3 pr-4">
                      <p className="text-sm font-medium text-primary">{cat.label}</p>
                      <p className="text-xs text-secondary">{cat.description}</p>
                    </td>
                    {CHANNEL_COLUMNS.map((c) => (
                      <td key={c.key} className="py-3 px-4 text-center">
                        <Switch
                          size="sm"
                          checked={pref[c.key]}
                          onChange={(checked) => toggle(cat.eventType, c.key, checked)}
                        />
                      </td>
                    ))}
                    <td className="py-3 pl-4 text-center">
                      <Switch
                        size="sm"
                        checked={pref.quietHoursEnabled}
                        onChange={(checked) => toggle(cat.eventType, 'quietHoursEnabled', checked)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
