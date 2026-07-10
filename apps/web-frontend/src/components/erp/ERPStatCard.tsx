import { TrendingUp, TrendingDown, type LucideIcon } from 'lucide-react';

interface Props {
  label: string;
  value: string;
  sub?: string;
  trend?: 'up' | 'down' | 'neutral';
  /** Token color utility class for the value text, e.g. 'text-brand', 'text-success'. */
  color?: string;
  icon?: LucideIcon;
}

/** KPI tile — per ERP-PLANNING/04_ERP_COMPONENT_LIBRARY.md §3. Extracted from
 * DashboardPage's inline KpiCard so every dashboard/analytics page shares one
 * implementation instead of re-declaring this per page. */
export default function ERPStatCard({ label, value, sub, trend, color = 'text-primary', icon: Icon }: Props) {
  return (
    <div className="bg-surface-card rounded-xl border border-default p-4">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs text-secondary uppercase tracking-wide">{label}</p>
        {Icon && <Icon size={14} className="text-disabled" />}
      </div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {sub && (
        <p className={`text-xs mt-1 flex items-center gap-1 ${trend === 'up' ? 'text-success' : trend === 'down' ? 'text-error' : 'text-secondary'}`}>
          {trend === 'up' && <TrendingUp size={12} />}
          {trend === 'down' && <TrendingDown size={12} />}
          {sub}
        </p>
      )}
    </div>
  );
}
