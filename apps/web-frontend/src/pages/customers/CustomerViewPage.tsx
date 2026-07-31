import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  customerApi,
  crmApi,
  crmAccountApi,
  loyaltyApi,
  referralApi,
  callApi,
} from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPDetailSkeleton, ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import ERPTabs from '../../components/erp/ERPTabs.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Modal from '../../components/ui/Modal.js';
import Checkbox from '../../components/ui/Checkbox.js';
import DatePicker from '../../components/ui/DatePicker.js';
import { formatDate, formatDatetime, formatCurrency } from '../../lib/format.js';

type ActivityType =
  | 'INVOICE'
  | 'PAYMENT'
  | 'RETURN'
  | 'ALTERATION'
  | 'LOYALTY_EARN'
  | 'LOYALTY_REDEEM'
  | 'LOYALTY_EXPIRE'
  | 'VISIT'
  | 'CALL'
  | 'COMPLAINT'
  | 'EMAIL'
  | 'WHATSAPP'
  | 'OTHER';

interface ActivityItem {
  type: ActivityType;
  date: string;
  id: number;
  [key: string]: unknown;
}

interface Interaction {
  id: number;
  type: string;
  notes?: string;
  followUpDate?: string;
  followUpDone?: boolean;
  createdAt: string;
}

interface PreferenceRow {
  channel: 'SMS' | 'WHATSAPP' | 'EMAIL' | 'IN_APP';
  category: 'PROMOTIONAL' | 'TRANSACTIONAL';
  consented: boolean;
}

const PREFERENCE_CHANNELS = ['SMS', 'WHATSAPP', 'EMAIL', 'IN_APP'] as const;
const PREFERENCE_CATEGORIES = ['PROMOTIONAL', 'TRANSACTIONAL'] as const;

const INTERACTION_TYPES = ['VISIT', 'CALL', 'COMPLAINT', 'EMAIL', 'WHATSAPP', 'OTHER'] as const;

const ACTIVITY_COLOR: Record<string, string> = {
  INVOICE: 'text-info',
  PAYMENT: 'text-success',
  RETURN: 'text-danger',
  ALTERATION: 'text-accent-purple',
  LOYALTY_EARN: 'text-warning',
  LOYALTY_REDEEM: 'text-warning',
  LOYALTY_EXPIRE: 'text-secondary',
  VISIT: 'text-info',
  CALL: 'text-info',
  COMPLAINT: 'text-danger',
  EMAIL: 'text-info',
  WHATSAPP: 'text-success',
  OTHER: 'text-secondary',
};

function activityLabel(item: ActivityItem): string {
  switch (item.type) {
    case 'INVOICE':
      return `Invoice #${String(item.invoiceNumber ?? item.id)} — ₹${Number(item.grandTotal ?? 0).toLocaleString()}`;
    case 'PAYMENT':
      return `Payment ₹${Number(item.amount ?? 0).toLocaleString()} via ${String(item.paymentMode ?? '')}`;
    case 'RETURN':
      return `Return #${String(item.returnNumber ?? item.id)}`;
    case 'ALTERATION':
      return `Alteration #${item.id}`;
    case 'LOYALTY_EARN':
      return `+${item.pointsEarned ?? 0} loyalty points`;
    case 'LOYALTY_REDEEM':
      return `-${item.pointsRedeemed ?? 0} points redeemed`;
    case 'LOYALTY_EXPIRE':
      return `${item.pointsExpired ?? 0} points expired`;
    default:
      return `${item.type} — ${String(item.notes ?? '')}`;
  }
}

const BLANK_INTERACTION = { type: 'VISIT' as string, notes: '', followUpDate: '' };

export default function CustomerViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canLogInteraction = hasPermission(PERMISSIONS.CRM_INTERACTION_CREATE);
  const canViewInteractions = hasPermission(PERMISSIONS.CRM_INTERACTION_VIEW);
  const canEditCustomer = hasPermission(PERMISSIONS.CUSTOMER_EDIT);
  const canCreateAccount = hasPermission(PERMISSIONS.CRM_ACCOUNT_CREATE);
  const canViewAccount = hasPermission(PERMISSIONS.CRM_ACCOUNT_VIEW);
  const canCreateTicket = hasPermission(PERMISSIONS.TICKET_CREATE);
  const canViewReferral = hasPermission(PERMISSIONS.REFERRAL_VIEW);
  const canInitiateCall = hasPermission(PERMISSIONS.CALL_INITIATE);
  const canViewCalls = hasPermission(PERMISSIONS.CALL_LOG_VIEW);

  const [tab, setTab] = useState<'details' | 'timeline' | 'interactions' | 'calls'>('details');
  const [logOpen, setLogOpen] = useState(false);
  const [interactionForm, setInteractionForm] = useState({ ...BLANK_INTERACTION });
  const [timelinePage, setTimelinePage] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ['customers', id],
    queryFn: () => customerApi.getById(Number(id)),
  });
  const customer = data as Record<string, unknown> | undefined;
  const accountId = customer?.accountId as number | undefined;

  // CRM-ROADMAP Phase 1, Feature 1: linked B2B account, if this customer has one.
  const { data: linkedAccountData } = useQuery({
    queryKey: ['crm-accounts', accountId],
    queryFn: () => crmAccountApi.getById(accountId!),
    enabled: !!accountId && canViewAccount,
  });
  const linkedAccount = linkedAccountData as Record<string, unknown> | undefined;

  const createAccountMut = useMutation({
    mutationFn: () => crmAccountApi.getOrCreateForCustomer(Number(id)),
    onSuccess: (created) => {
      const account = created as Record<string, unknown>;
      toast.success('Account created for this customer');
      qc.invalidateQueries({ queryKey: ['customers', id] });
      navigate(`/crm/accounts/${account.id}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // CRM-ROADMAP Phase 4, Feature 7 — CTI: click-to-call rings the rep's own phone first (from
  // their profile), then bridges to the customer's number once answered — see CallService.
  const callMut = useMutation({
    mutationFn: () =>
      callApi.initiate({ customerId: Number(id), toNumber: String(customer?.phone ?? '') }),
    onSuccess: () =>
      toast.success('Calling your phone now — it will connect to the customer once you answer'),
    onError: (err: Error) => toast.error(err.message),
  });

  const { data: callsData } = useQuery({
    queryKey: ['customer-calls', id],
    queryFn: () => callApi.list({ customerId: Number(id) }),
    enabled: tab === 'calls' && canViewCalls,
  });
  const calls = (callsData as { content?: Array<Record<string, unknown>> })?.content ?? [];

  // CRM-ROADMAP Phase 1, Feature 3 — Customer 360 Command Center: one composed read for
  // health score, AR/credit snapshot, and linked account — replaces the separate stored
  // customer.healthScore/healthSegment (last computed by the weekly batch job) with a
  // fresh, on-demand HealthScoringService.scoreCustomer result once loaded.
  const { data: threeSixtyData } = useQuery({
    queryKey: ['customer-360', id],
    queryFn: () => customerApi.get360(Number(id)),
  });
  const threeSixty = threeSixtyData as
    | {
        health: { totalScore: number; segment: string } | null;
        financial: {
          currentBalance: number;
          overdueAmount: number;
          creditLimitEnabled: boolean;
          creditHeadroom: number | null;
          // CRM-ROADMAP Phase 1, Feature 5 — ERP-Native Integration Layer.
          isOverLimit: boolean;
        } | null;
        recentItemsStock: Array<{
          itemId: number;
          itemName: string;
          itemCode: string | null;
          totalAvailableQty: number;
          warehouseCount: number;
        }>;
        // CRM-ROADMAP Phase 3, Feature 1 — AI & Predictive Intelligence Suite.
        churn: {
          riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'INSUFFICIENT_DATA';
          riskScore: number | null;
          reason: string;
        } | null;
        nextBestAction: { id: number; actionText: string; reason: string } | null;
        productRecommendations: Array<{
          id: number;
          itemId: number;
          itemName: string;
          reason: string;
        }>;
        degraded: string[];
      }
    | undefined;

  // CRM-ROADMAP Phase 2, Feature 3: tier is derived server-side from lifetime points earned
  // (never demoted automatically) — this page just displays it, never assigns it directly.
  const { data: loyaltyData } = useQuery({
    queryKey: ['customer-loyalty', id],
    queryFn: () => loyaltyApi.balance(Number(id)),
  });
  const loyalty = loyaltyData as
    | {
        points: number;
        tier: string | null;
        nextTier: { name: string; pointsNeeded: number } | null;
      }
    | undefined;

  // CRM-ROADMAP Phase 2, Feature 4 — "Refer a Friend" card; get-or-creates the code on first
  // view rather than requiring a separate explicit "generate" action.
  const { data: referralCodeData } = useQuery({
    queryKey: ['customer-referral-code', id],
    queryFn: () => referralApi.getOrCreateCode(Number(id)),
    enabled: canViewReferral,
  });
  const referralCode = (referralCodeData as { code?: string } | undefined)?.code;
  // Points at the tracked GET /r/:code redirect (records a CLICKED event before forwarding to
  // the /refer/:code landing page), not straight at the landing page — a link shared without
  // going through that route would never show up in the funnel stats.
  const referralLink = referralCode
    ? `${import.meta.env['VITE_GATEWAY_URL'] ?? 'http://localhost:3000'}/api/sales/r/${referralCode}`
    : null;

  // CP-7 follow-up: granular consent model, additive to the binary opt-out flags above.
  const { data: prefsData } = useQuery({
    queryKey: ['customer-preferences', id],
    queryFn: () => customerApi.listPreferences(Number(id)),
    enabled: tab === 'details',
  });
  const preferences: PreferenceRow[] = (prefsData as { content?: PreferenceRow[] })?.content ?? [];

  const { data: timelineData, isFetching: timelineFetching } = useQuery({
    queryKey: ['customer-timeline', id, timelinePage],
    queryFn: () => crmApi.activityTimeline(Number(id), { page: timelinePage, size: 20 }),
    enabled: tab === 'timeline',
  });
  const timelineItems: ActivityItem[] =
    ((timelineData as Record<string, unknown>)?.items as ActivityItem[]) ?? [];
  const timelineTotal: number = ((timelineData as Record<string, unknown>)?.total as number) ?? 0;

  const { data: interactionData } = useQuery({
    queryKey: ['customer-interactions', id],
    queryFn: () => crmApi.listInteractions(Number(id)),
    enabled: tab === 'interactions' && canViewInteractions,
  });
  const interactions: Interaction[] =
    (interactionData as { content?: Interaction[] })?.content ?? [];

  const logMut = useMutation({
    mutationFn: () =>
      crmApi.logInteraction(Number(id), {
        type: interactionForm.type,
        notes: interactionForm.notes || undefined,
        followUpDate: interactionForm.followUpDate || undefined,
      }),
    onSuccess: () => {
      toast.success('Interaction logged');
      qc.invalidateQueries({ queryKey: ['customer-interactions', id] });
      qc.invalidateQueries({ queryKey: ['customer-timeline', id] });
      setLogOpen(false);
      setInteractionForm({ ...BLANK_INTERACTION });
    },
    onError: () => toast.error('Failed to log interaction'),
  });

  const optOutMut = useMutation({
    mutationFn: (data: { optOutSms?: boolean; optOutWhatsapp?: boolean; optOutEmail?: boolean }) =>
      customerApi.optOut(Number(id), data),
    onSuccess: () => {
      toast.success('Communication preferences updated');
      qc.invalidateQueries({ queryKey: ['customers', id] });
    },
    onError: () => toast.error('Failed to update communication preferences'),
  });

  const savePreferenceMut = useMutation({
    mutationFn: (pref: PreferenceRow) => customerApi.updatePreferences(Number(id), [pref]),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer-preferences', id] });
    },
    onError: () => toast.error('Failed to update preference'),
  });

  // CRM-ROADMAP Phase 3, Feature 1 — dismissing a recommendation removes it from view
  // immediately and doesn't re-surface the identical suggestion on the next nightly run
  // (enforced server-side; see HealthScoringService.computeAndCachePredictions).
  const feedbackMut = useMutation({
    mutationFn: (vars: {
      recommendationId: number;
      recommendationType: 'NEXT_BEST_ACTION' | 'PRODUCT_RECOMMENDATION';
      action: 'DISMISS' | 'ACCEPT';
    }) =>
      customerApi.recommendationFeedback(vars.recommendationId, {
        recommendationType: vars.recommendationType,
        action: vars.action,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer-360', id] });
    },
    onError: () => toast.error('Failed to record feedback'),
  });

  if (isLoading) return <ERPDetailSkeleton />;
  if (!customer) return <ERPEmptyState type="no-data" title="Customer not found" />;

  const billing = customer.billingAddress as Record<string, string> | undefined;
  const healthSeg = threeSixty?.health?.segment ?? (customer.healthSegment as string | undefined);
  const healthScore =
    threeSixty?.health?.totalScore ?? (customer.healthScore as number | undefined);

  const healthColor: Record<string, 'green' | 'blue' | 'yellow' | 'red' | 'gray'> = {
    CHAMPION: 'green',
    LOYAL: 'blue',
    AT_RISK: 'yellow',
    LOST: 'red',
  };

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title={String(customer.displayName)}
        subtitle={`Customer Code: ${customer.customerCode}`}
        actions={
          <div className="flex gap-2 flex-wrap">
            {canLogInteraction && (
              <Button onClick={() => setLogOpen(true)}>+ Log Interaction</Button>
            )}
            {canCreateTicket && (
              <Button
                variant="secondary"
                onClick={() => navigate(`/crm/tickets/new?customerId=${id}`)}
              >
                + New Ticket
              </Button>
            )}
            <Button variant="secondary" onClick={() => navigate(`/customers/${id}/edit`)}>
              Edit
            </Button>
            <Button variant="secondary" onClick={() => navigate('/customers')}>
              Back
            </Button>
          </div>
        }
      />

      {/* Customer 360: partial-degradation notice — the composed endpoint renders whatever
          sections succeeded rather than 500ing the whole page if one sub-service is slow/down. */}
      {threeSixty && threeSixty.degraded.length > 0 && (
        <div className="mb-4 bg-warning-subtle border border-warning/30 rounded-xl px-4 py-2.5 text-xs text-secondary">
          Some sections ({threeSixty.degraded.join(', ')}) couldn&apos;t load just now — the rest of
          this page is unaffected.
        </div>
      )}

      {/* Health score strip */}
      {healthSeg && (
        <div className="mb-4 flex items-center gap-3 bg-surface-card rounded-xl border border-default px-5 py-3 flex-wrap">
          <span className="text-xs text-secondary font-medium uppercase tracking-wide">Health</span>
          <Badge label={healthSeg} color={healthColor[healthSeg] ?? 'gray'} />
          {healthScore != null && (
            <div className="flex-1 max-w-xs">
              <div className="h-2 bg-surface-raised rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${healthScore}%` }}
                />
              </div>
            </div>
          )}
          {healthScore != null && <span className="text-xs text-secondary">{healthScore}/100</span>}
        </div>
      )}

      {/* CRM-ROADMAP Phase 2, Feature 3 — Loyalty Tier strip. Only shown once at least one tier
          is configured for the tenant (loyalty.tier is null otherwise). */}
      {loyalty?.tier && (
        <div className="mb-4 flex items-center gap-3 bg-surface-card rounded-xl border border-default px-5 py-3 flex-wrap">
          <span className="text-xs text-secondary font-medium uppercase tracking-wide">
            Loyalty Tier
          </span>
          <Badge label={loyalty.tier} color="blue" />
          {loyalty.nextTier && (
            <span className="text-xs text-secondary">
              {loyalty.nextTier.pointsNeeded} points to {loyalty.nextTier.name}
            </span>
          )}
        </div>
      )}

      {/* CRM-ROADMAP Phase 3, Feature 1 — AI & Predictive Intelligence Suite. Every card ships
          a non-empty, specific "why" — no bare scores without rationale (a stated DoD
          requirement). Churn risk is informational only (no dismiss); next-best-action and
          product recommendations can each be dismissed, which removes them here immediately
          and stops the next nightly run from re-surfacing the identical suggestion. */}
      {threeSixty?.churn && (
        <div className="mb-4 bg-surface-card rounded-xl border border-default px-5 py-3">
          {threeSixty.churn.riskLevel === 'INSUFFICIENT_DATA' ? (
            <p className="text-xs text-secondary">
              <span className="font-medium uppercase tracking-wide mr-2">Churn Risk</span>
              Not enough purchase history yet to predict churn risk.
            </p>
          ) : (
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs text-secondary font-medium uppercase tracking-wide">
                Churn Risk
              </span>
              <Badge
                label={threeSixty.churn.riskLevel}
                color={
                  threeSixty.churn.riskLevel === 'HIGH'
                    ? 'red'
                    : threeSixty.churn.riskLevel === 'MEDIUM'
                      ? 'yellow'
                      : 'green'
                }
              />
              <span className="text-xs text-secondary">{threeSixty.churn.reason}</span>
            </div>
          )}
        </div>
      )}

      {threeSixty?.nextBestAction && (
        <div className="mb-4 bg-surface-card rounded-xl border border-default px-5 py-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <span className="text-xs text-secondary font-medium uppercase tracking-wide">
                Next Best Action
              </span>
              <p className="text-sm font-medium text-primary mt-0.5">
                {threeSixty.nextBestAction.actionText}
              </p>
              <p className="text-xs text-secondary mt-0.5">{threeSixty.nextBestAction.reason}</p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                feedbackMut.mutate({
                  recommendationId: threeSixty.nextBestAction!.id,
                  recommendationType: 'NEXT_BEST_ACTION',
                  action: 'DISMISS',
                })
              }
              disabled={feedbackMut.isPending}
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {threeSixty && threeSixty.productRecommendations.length > 0 && (
        <div className="mb-4 bg-surface-card rounded-xl border border-default px-5 py-3">
          <span className="text-xs text-secondary font-medium uppercase tracking-wide">
            Recommended for This Customer
          </span>
          <div className="mt-2 space-y-2">
            {threeSixty.productRecommendations.map((rec) => (
              <div
                key={rec.id}
                className="flex items-start justify-between gap-3 border-b border-default last:border-0 pb-2 last:pb-0"
              >
                <div>
                  <p className="text-sm font-medium text-primary">{rec.itemName}</p>
                  <p className="text-xs text-secondary mt-0.5">{rec.reason}</p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    feedbackMut.mutate({
                      recommendationId: rec.id,
                      recommendationType: 'PRODUCT_RECOMMENDATION',
                      action: 'DISMISS',
                    })
                  }
                  disabled={feedbackMut.isPending}
                >
                  Dismiss
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <ERPTabs
        className="mb-5"
        tabs={[
          { key: 'details', label: 'Details' },
          { key: 'timeline', label: 'Activity Timeline' },
          { key: 'interactions', label: 'Interactions' },
          { key: 'calls', label: 'Calls' },
        ]}
        active={tab}
        onChange={(key) => setTab(key as typeof tab)}
      />

      {/* Details Tab */}
      {tab === 'details' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-surface-card rounded-xl border border-default p-5">
              <h2 className="text-sm font-semibold text-secondary mb-4 uppercase tracking-wide">
                Details
              </h2>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  {
                    label: 'Phone',
                    value: customer.phone ? (
                      <span className="flex items-center gap-2">
                        {String(customer.phone)}
                        {canInitiateCall && (
                          <Button
                            size="xs"
                            variant="secondary"
                            disabled={callMut.isPending}
                            onClick={() => callMut.mutate()}
                          >
                            {callMut.isPending ? 'Calling…' : 'Call'}
                          </Button>
                        )}
                      </span>
                    ) : undefined,
                  },
                  { label: 'Email', value: customer.email },
                  { label: 'GSTIN', value: customer.gstin },
                  { label: 'PAN', value: customer.pan },
                  { label: 'Type', value: customer.customerType },
                  {
                    label: 'Status',
                    value: (
                      <Badge
                        label={String(customer.status)}
                        color={customer.status === 'ACTIVE' ? 'green' : 'gray'}
                      />
                    ),
                  },
                  {
                    label: 'Date of Birth',
                    value: customer.dateOfBirth
                      ? formatDate(String(customer.dateOfBirth))
                      : undefined,
                  },
                  { label: 'Loyalty Card', value: customer.loyaltyCardNumber },
                  {
                    label: 'Account',
                    value: linkedAccount ? (
                      <button
                        onClick={() => navigate(`/crm/accounts/${accountId}`)}
                        className="text-link hover:underline"
                      >
                        {String(linkedAccount.name)}
                      </button>
                    ) : canCreateAccount ? (
                      <button
                        onClick={() => createAccountMut.mutate()}
                        disabled={createAccountMut.isPending}
                        className="text-link hover:underline text-xs"
                      >
                        {createAccountMut.isPending ? 'Creating…' : '+ Create B2B account'}
                      </button>
                    ) : undefined,
                  },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <dt className="text-xs text-disabled">{label}</dt>
                    <dd className="text-sm text-primary font-medium">
                      {(value as React.ReactNode) ?? '–'}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
            {billing && (
              <div className="bg-surface-card rounded-xl border border-default p-5">
                <h2 className="text-sm font-semibold text-secondary mb-3 uppercase tracking-wide">
                  Billing Address
                </h2>
                <p className="text-sm text-primary">
                  {billing.addressLine1}
                  {billing.city ? `, ${billing.city}` : ''}
                  {billing.state ? `, ${billing.state}` : ''} {billing.pinCode}
                </p>
              </div>
            )}
            {/* CRM-ROADMAP Phase 2, Feature 4 — Referral Program Engine. Code is get-or-created
                lazily on first view, not a separate explicit "generate" step. */}
            {canViewReferral && referralLink && (
              <div className="bg-surface-card rounded-xl border border-default p-5">
                <h2 className="text-sm font-semibold text-secondary mb-3 uppercase tracking-wide">
                  Refer a Friend
                </h2>
                <p className="text-sm text-primary mb-2">
                  Code: <span className="font-mono font-semibold">{referralCode}</span>
                </p>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={referralLink}
                    className="flex-1 min-w-0 rounded-lg border border-default bg-surface-subtle px-3 py-1.5 text-xs text-secondary"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      void navigator.clipboard.writeText(referralLink);
                      toast.success('Referral link copied');
                    }}
                  >
                    Copy
                  </Button>
                </div>
              </div>
            )}
            {/* CRM-ROADMAP Phase 1, Feature 5 — ERP-Native Integration Layer: live stock
                relevance for this customer's most recently purchased items, aggregated
                across every warehouse (never just one) — the "12 in stock" context a rep
                would otherwise have to switch to Inventory to see. */}
            {threeSixty && threeSixty.recentItemsStock.length > 0 && (
              <div className="bg-surface-card rounded-xl border border-default p-5">
                <h2 className="text-sm font-semibold text-secondary mb-3 uppercase tracking-wide">
                  Recently Purchased — Stock
                </h2>
                <div className="space-y-2">
                  {threeSixty.recentItemsStock.map((s) => (
                    <div key={s.itemId} className="flex items-center justify-between text-sm">
                      <span className="text-primary">
                        {s.itemName}
                        {s.itemCode && <span className="text-secondary"> ({s.itemCode})</span>}
                      </span>
                      <Badge
                        label={
                          s.totalAvailableQty > 0
                            ? `${s.totalAvailableQty} in stock${s.warehouseCount > 1 ? ` (${s.warehouseCount} warehouses)` : ''}`
                            : 'Out of stock'
                        }
                        color={s.totalAvailableQty > 0 ? 'green' : 'red'}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="space-y-4">
            {[
              // CRM-ROADMAP Phase 1, Feature 3/5: live AR snapshot from the 360 endpoint
              // (CustomerFinancialSnapshotService), not the customer row's static fields.
              {
                label: 'Current Balance',
                value: threeSixty?.financial ? (
                  <span className={threeSixty.financial.isOverLimit ? 'text-danger' : undefined}>
                    {formatCurrency(threeSixty.financial.currentBalance)}
                    {threeSixty.financial.isOverLimit && <Badge label="OVER LIMIT" color="red" />}
                  </span>
                ) : (
                  '—'
                ),
              },
              {
                label: 'Credit Headroom',
                value: !threeSixty?.financial
                  ? '—'
                  : threeSixty.financial.creditHeadroom === null
                    ? 'No limit set'
                    : formatCurrency(threeSixty.financial.creditHeadroom),
              },
              { label: 'Credit Limit', value: formatCurrency(Number(customer.creditLimit ?? 0)) },
              { label: 'Credit Days', value: `${customer.creditDays ?? 0} days` },
              {
                label: 'Opening Balance',
                value: formatCurrency(Number(customer.openingBalance ?? 0)),
              },
              { label: 'Loyalty Points', value: String(customer.loyaltyPoints ?? 0) },
            ].map(({ label, value }) => (
              <div key={label} className="bg-surface-card rounded-xl border border-default p-5">
                <p className="text-xs text-disabled uppercase tracking-wide mb-1">{label}</p>
                <p className="text-lg font-bold text-primary">{value}</p>
              </div>
            ))}
            <div className="bg-surface-card rounded-xl border border-default p-5">
              <p className="text-xs text-disabled uppercase tracking-wide mb-3">
                Communication Preferences
              </p>
              <div className="space-y-2.5">
                {(
                  [
                    { key: 'optOutSms', label: 'SMS' },
                    { key: 'optOutWhatsapp', label: 'WhatsApp' },
                    { key: 'optOutEmail', label: 'Email' },
                  ] as const
                ).map(({ key, label }) => {
                  const optedOut = Boolean(customer[key]);
                  return (
                    <div
                      key={key}
                      className="flex items-center justify-between text-sm text-primary"
                    >
                      <span>{label}</span>
                      <Checkbox
                        checked={!optedOut}
                        disabled={!canEditCustomer || optOutMut.isPending}
                        onChange={(e) =>
                          optOutMut.mutate({ [key]: !e.target.checked } as Record<string, boolean>)
                        }
                      />
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-disabled mt-3">
                Checked = customer receives messages on that channel.
              </p>
            </div>

            <div className="bg-surface-card rounded-xl border border-default p-5">
              <p className="text-xs text-disabled uppercase tracking-wide mb-1">Detailed Consent</p>
              <p className="text-xs text-disabled mb-3">
                Finer-grained than the flags above — lets a customer opt out of promotional messages
                on a channel while still receiving transactional ones (order updates, receipts). The
                flags above remain the enforced fallback when no row exists here.
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-disabled text-xs">
                    <th className="pb-2 font-normal">Channel</th>
                    {PREFERENCE_CATEGORIES.map((cat) => (
                      <th key={cat} className="pb-2 font-normal text-center">
                        {cat === 'PROMOTIONAL' ? 'Promotional' : 'Transactional'}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-default">
                  {PREFERENCE_CHANNELS.map((channel) => (
                    <tr key={channel}>
                      <td className="py-2 text-primary">{channel}</td>
                      {PREFERENCE_CATEGORIES.map((category) => {
                        const existing = preferences.find(
                          (p) => p.channel === channel && p.category === category
                        );
                        // No row yet = treated as consented (matches the binary flags'
                        // default-opted-in behavior).
                        const consented = existing?.consented ?? true;
                        return (
                          <td key={category} className="py-2 text-center">
                            <Checkbox
                              checked={consented}
                              disabled={!canEditCustomer || savePreferenceMut.isPending}
                              onChange={(e) =>
                                savePreferenceMut.mutate({
                                  channel,
                                  category,
                                  consented: e.target.checked,
                                })
                              }
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Activity Timeline Tab */}
      {tab === 'timeline' && (
        <div className="bg-surface-card rounded-xl border border-default">
          {timelineFetching ? (
            <div className="p-4">
              <ERPTableSkeleton rows={5} cols={2} />
            </div>
          ) : timelineItems.length === 0 ? (
            <ERPEmptyState
              type="no-data"
              title="No activity recorded yet"
              description="Invoices, payments, and loyalty events for this customer will appear here."
            />
          ) : (
            <>
              <div className="divide-y divide-default">
                {timelineItems.map((item, i) => (
                  <div
                    key={`${item.type}-${item.id}-${i}`}
                    className="flex items-start gap-4 px-5 py-3"
                  >
                    <div
                      className={`mt-0.5 text-xs font-bold uppercase ${ACTIVITY_COLOR[item.type] ?? 'text-secondary'}`}
                    >
                      {item.type.replace(/_/g, ' ')}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-primary">{activityLabel(item)}</p>
                      <p className="text-xs text-secondary mt-0.5">{formatDatetime(item.date)}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="px-5 py-3 border-t border-default flex items-center justify-between text-xs text-secondary">
                <span>{timelineTotal} total events</span>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setTimelinePage((p) => Math.max(0, p - 1))}
                    disabled={timelinePage === 0}
                  >
                    ← Prev
                  </Button>
                  <span className="px-2 py-1">Page {timelinePage + 1}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setTimelinePage((p) => p + 1)}
                    disabled={(timelinePage + 1) * 20 >= timelineTotal}
                  >
                    Next →
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Interactions Tab */}
      {tab === 'interactions' && (
        <div className="bg-surface-card rounded-xl border border-default">
          {!canViewInteractions ? (
            <ERPEmptyState type="no-access" title="No permission to view interactions" />
          ) : interactions.length === 0 ? (
            <ERPEmptyState
              type="no-data"
              title="No interactions logged yet"
              description="Calls, visits, complaints and other interactions will appear here."
              {...(canLogInteraction
                ? { action: { label: '+ Log Interaction', onClick: () => setLogOpen(true) } }
                : {})}
            />
          ) : (
            <div className="divide-y divide-default">
              {interactions.map((i) => (
                <div key={i.id} className="flex items-start gap-4 px-5 py-3">
                  <Badge label={i.type} color="blue" />
                  <div className="flex-1 min-w-0">
                    {i.notes && <p className="text-sm text-primary">{i.notes}</p>}
                    {i.followUpDate && (
                      <p
                        className={`text-xs mt-0.5 ${i.followUpDone ? 'text-secondary line-through' : 'text-warning'}`}
                      >
                        Follow-up: {formatDate(i.followUpDate)}
                        {i.followUpDone ? ' (done)' : ''}
                      </p>
                    )}
                    <p className="text-xs text-secondary mt-0.5">{formatDatetime(i.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'calls' && (
        <div className="bg-surface-card rounded-xl border border-default">
          {!canViewCalls ? (
            <ERPEmptyState type="no-access" title="No permission to view call history" />
          ) : calls.length === 0 ? (
            <ERPEmptyState
              type="no-data"
              title="No calls logged yet"
              description="Calls made via the Call button above will appear here."
            />
          ) : (
            <div className="divide-y divide-default">
              {calls.map((c) => (
                <div key={String(c.id)} className="flex items-start gap-4 px-5 py-3">
                  <Badge
                    label={String(c.status)}
                    color={
                      c.status === 'COMPLETED'
                        ? 'green'
                        : c.status === 'FAILED' || c.status === 'NO_ANSWER'
                          ? 'red'
                          : 'gray'
                    }
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-primary">
                      {String(c.direction) === 'OUTBOUND' ? 'Outbound' : 'Inbound'} call to{' '}
                      {String(c.toNumber)}
                      {c.durationSeconds ? ` · ${c.durationSeconds}s` : ''}
                    </p>
                    {typeof c.notes === 'string' && c.notes && (
                      <p className="text-xs text-secondary mt-0.5">{c.notes}</p>
                    )}
                    <p className="text-xs text-secondary mt-0.5">
                      {formatDatetime(String(c.startedAt))}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Log Interaction Modal */}
      <Modal open={logOpen} onClose={() => setLogOpen(false)} title="Log Customer Interaction">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-secondary mb-1.5">
              Interaction Type
            </label>
            <div className="flex gap-2 flex-wrap">
              {INTERACTION_TYPES.map((t) => (
                <button
                  key={t}
                  onClick={() => setInteractionForm((f) => ({ ...f, type: t }))}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    interactionForm.type === t
                      ? 'bg-primary text-white border-primary'
                      : 'border-default text-secondary hover:bg-surface-raised'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-secondary mb-1.5">
              Notes (optional)
            </label>
            <textarea
              value={interactionForm.notes}
              onChange={(e) => setInteractionForm((f) => ({ ...f, notes: e.target.value }))}
              rows={3}
              placeholder="What was discussed…"
              className="w-full rounded-lg border border-default bg-surface-card text-primary text-sm px-3 py-2 resize-none"
            />
          </div>
          <div>
            <DatePicker
              label="Follow-up Date (optional)"
              value={interactionForm.followUpDate}
              onChange={(v) => setInteractionForm((f) => ({ ...f, followUpDate: v }))}
            />
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="ghost" onClick={() => setLogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => logMut.mutate()} disabled={logMut.isPending}>
              {logMut.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
