import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { Filter, Megaphone, TicketCheck, Users, TrendingUp } from 'lucide-react';
import { crmDashboardApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import ChartCard from '../../components/erp/ChartCard.js';
import ERPStatCard from '../../components/erp/ERPStatCard.js';
import Input from '../../components/ui/Input.js';

// CRM-ROADMAP Phase 1, Feature 8 — CRM Dashboards & KPI Tracking. The manager-facing
// counterpart to Customer 360 (Feature 3, rep-facing). Each section is rendered only if the
// backend included it — the API omits (rather than 403s) a section the caller lacks the
// underlying permission for (see crm-dashboard.routes.ts's `hiddenSections`), so a manager
// without TICKET_VIEW simply never sees that card, no error state to handle here.

const STAGE_LABELS: Record<string, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  QUALIFIED: 'Qualified',
  CONVERTED: 'Converted',
  LOST: 'Lost',
};

const COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

interface LeadFunnelStage {
  stage: string;
  count: number;
  percentage: number;
}

interface DashboardResponse {
  leadFunnel: { total: number; stages: LeadFunnelStage[] } | null;
  ticketSla: {
    resolvedCount: number;
    compliantCount: number;
    complianceRate: number | null;
  } | null;
  campaignPerformance: {
    campaignCount: number;
    totalRecipients: number;
    sentCount: number;
    deliveredCount: number;
    failedCount: number;
    deliveryRate: number | null;
  } | null;
  quotaAttainment: {
    periodYear: number;
    periodMonth: number;
    rows: Array<{
      quotaId: number;
      subjectType: 'REP' | 'TERRITORY';
      subjectName: string;
      quotaAmount?: number;
      actualAmount?: number;
      attainmentPct?: number | null;
    }>;
    totalQuota?: number;
    totalActual?: number;
    totalAttainmentPct?: number | null;
  } | null;
  hiddenSections: string[];
}

function pct(n: number | null): string {
  return n === null ? '–' : `${n}%`;
}

export default function CrmDashboardPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['crm-dashboard', from, to],
    queryFn: () =>
      crmDashboardApi.get({
        from: from || undefined,
        to: to || undefined,
      }) as Promise<DashboardResponse>,
  });

  const funnelChartData =
    data?.leadFunnel?.stages.map((s) => ({
      name: STAGE_LABELS[s.stage] ?? s.stage,
      count: s.count,
    })) ?? [];

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="CRM Dashboard"
        subtitle="Lead funnel, ticket SLA health, and campaign performance in one view."
      />

      <div className="flex items-center gap-3 mb-4">
        <Filter size={14} className="text-secondary" />
        <Input
          type="date"
          aria-label="From date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="max-w-[160px]"
        />
        <span className="text-secondary text-sm">to</span>
        <Input
          type="date"
          aria-label="To date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="max-w-[160px]"
        />
      </div>

      {isError ? (
        <ERPEmptyState type="error" />
      ) : isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-64 rounded-xl border border-default bg-surface-card animate-pulse"
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {data?.leadFunnel && (
            <ChartCard title="Lead Funnel" icon={Users} height={220}>
              {data.leadFunnel.total === 0 ? (
                <ERPEmptyState
                  type="no-data"
                  title="No leads yet"
                  description="Leads captured in this period will show up here."
                />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={funnelChartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {funnelChartData.map((_e, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          )}

          {data?.ticketSla && (
            <ChartCard title="Ticket SLA Compliance" icon={TicketCheck}>
              {data.ticketSla.resolvedCount === 0 ? (
                <ERPEmptyState
                  type="no-data"
                  title="No resolved tickets yet"
                  description="SLA compliance shows up once tickets are resolved in this period."
                />
              ) : (
                <ERPStatCard
                  label="Compliance Rate"
                  value={pct(data.ticketSla.complianceRate)}
                  icon={TicketCheck}
                  sub={`${data.ticketSla.compliantCount} of ${data.ticketSla.resolvedCount} resolved tickets met their SLA`}
                />
              )}
            </ChartCard>
          )}

          {data?.campaignPerformance && (
            <ChartCard title="Campaign Performance" icon={Megaphone}>
              {data.campaignPerformance.campaignCount === 0 ? (
                <ERPEmptyState
                  type="no-data"
                  title="No campaigns sent yet"
                  description="Send a campaign to see delivery performance here."
                />
              ) : (
                <ERPStatCard
                  label="Delivery Rate"
                  value={pct(data.campaignPerformance.deliveryRate)}
                  icon={Megaphone}
                  sub={`${data.campaignPerformance.deliveredCount} of ${data.campaignPerformance.totalRecipients} recipients delivered across ${data.campaignPerformance.campaignCount} campaigns (${data.campaignPerformance.failedCount} failed)`}
                />
              )}
            </ChartCard>
          )}

          {data?.quotaAttainment && (
            <ChartCard title="Quota Attainment" icon={TrendingUp}>
              {data.quotaAttainment.rows.length === 0 ? (
                <ERPEmptyState
                  type="no-data"
                  title="No quotas set for this month"
                  description="Set a rep or territory quota on the Quotas page to track attainment here."
                />
              ) : data.quotaAttainment.totalAttainmentPct !== undefined ? (
                <ERPStatCard
                  label="Overall Attainment"
                  value={pct(data.quotaAttainment.totalAttainmentPct ?? null)}
                  icon={TrendingUp}
                  sub={`₹${data.quotaAttainment.totalActual ?? 0} of ₹${data.quotaAttainment.totalQuota ?? 0} target across ${data.quotaAttainment.rows.length} quota(s)`}
                />
              ) : (
                <p className="text-sm text-secondary">
                  {data.quotaAttainment.rows.length} quota(s) set for this month — you don't have
                  permission to view the amounts.
                </p>
              )}
            </ChartCard>
          )}
        </div>
      )}
    </div>
  );
}
