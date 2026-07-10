import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

interface Props {
  title: string;
  icon?: LucideIcon;
  iconClassName?: string;
  height?: number;
  children: ReactNode;
  /** Spans 2 of 3 grid columns on the parent's `lg:grid-cols-3` layout, matching the
   * "headline chart gets more room" pattern already used on DashboardPage. */
  wide?: boolean;
}

/** Wraps a Recharts chart with the consistent card header/container every dashboard and
 * analytics page needs — per ERP-PLANNING/03_ERP_DESIGN_SYSTEM.md Part 6 and
 * ERP-PLANNING/04_ERP_COMPONENT_LIBRARY.md §8. Callers still bring their own
 * `<ResponsiveContainer>`/chart JSX as `children` — this only standardizes the chrome
 * around it, not the charting library. */
export default function ChartCard({ title, icon: Icon, iconClassName = 'text-brand', height, children, wide }: Props) {
  return (
    <div className={`bg-surface-card border border-default rounded-xl p-4 ${wide ? 'lg:col-span-2' : ''}`}>
      <h3 className="text-sm font-semibold text-primary mb-3 flex items-center gap-2">
        {Icon && <Icon size={15} className={iconClassName} />}
        {title}
      </h3>
      <div style={height ? { height } : undefined}>{children}</div>
    </div>
  );
}
