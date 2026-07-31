import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { crmApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Badge from '../../components/ui/Badge.js';
import { formatCurrency } from '../../lib/format.js';

interface RoiRow {
  campaignId: number;
  name: string;
  channel: 'SMS' | 'WHATSAPP' | 'EMAIL' | 'IN_APP';
  sentCount: number;
  conversions: number;
  revenue: number;
  cost: number;
  roi: number | null;
}

const CHANNEL_COLORS: Record<string, 'green' | 'blue' | 'gray'> = {
  WHATSAPP: 'green',
  SMS: 'blue',
  EMAIL: 'gray',
  IN_APP: 'gray',
};

// CRM-ROADMAP Phase 3, Feature 3 — cross-campaign ROI report, ranked by attributed revenue.
// Revenue is a real, snapshotted figure (see CampaignService.getRoiReport's own comment); cost
// is a live estimate from the tenant's configured per-channel rate (Campaign Settings).
export default function CampaignRoiReportPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['campaign-roi-report'],
    queryFn: () => crmApi.campaignRoiReport(),
  });
  const rows: RoiRow[] = (data as { content?: RoiRow[] })?.content ?? [];

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Campaign ROI Report"
        subtitle="Revenue attributed to each campaign vs. estimated send cost, ranked by revenue"
      />

      <div className="bg-surface-card rounded-xl border border-default">
        {isLoading ? (
          <ERPTableSkeleton rows={6} cols={5} />
        ) : rows.length === 0 ? (
          <ERPEmptyState
            type="no-data"
            title="No sent campaigns yet"
            description="Campaign ROI appears here once at least one campaign has been sent."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-secondary border-b border-default">
                  <th className="px-4 py-3">Campaign</th>
                  <th className="px-4 py-3">Channel</th>
                  <th className="px-4 py-3">Sent</th>
                  <th className="px-4 py-3">Conversions</th>
                  <th className="px-4 py-3">Revenue</th>
                  <th className="px-4 py-3">Cost</th>
                  <th className="px-4 py-3">ROI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-default">
                {rows.map((r) => (
                  <tr
                    key={r.campaignId}
                    onClick={() => navigate(`/crm/campaigns/${r.campaignId}`)}
                    className="cursor-pointer hover:bg-surface-raised"
                  >
                    <td className="px-4 py-3 font-medium text-primary">{r.name}</td>
                    <td className="px-4 py-3">
                      <Badge label={r.channel} color={CHANNEL_COLORS[r.channel] ?? 'gray'} />
                    </td>
                    <td className="px-4 py-3">{r.sentCount}</td>
                    <td className="px-4 py-3">{r.conversions}</td>
                    <td className="px-4 py-3">{formatCurrency(r.revenue)}</td>
                    <td className="px-4 py-3">{formatCurrency(r.cost)}</td>
                    <td className="px-4 py-3">
                      {r.roi === null ? '—' : `${(r.roi * 100).toFixed(0)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
