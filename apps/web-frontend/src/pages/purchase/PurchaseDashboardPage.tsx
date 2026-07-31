import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, PackageCheck, Wallet, TrendingUp } from 'lucide-react';
import { purchaseDashboardApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { formatCurrency } from '../../lib/format.js';

interface DashboardSummary {
  pendingPOCount: number;
  pendingPOValue: string;
  pendingGRNCount: number;
  thisMonthPurchaseTotal: string;
  supplierOutstanding: string;
  topSuppliers: Array<{ supplierId: number; supplierName?: string; total: string }>;
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sublabel,
  onClick,
}: {
  icon: typeof ClipboardList;
  label: string;
  value: string;
  sublabel?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="text-left bg-surface-card rounded-xl border border-default p-5 hover:border-brand transition-colors disabled:cursor-default disabled:hover:border-default"
    >
      <div className="flex items-center gap-2 text-secondary mb-2">
        <Icon size={16} />
        <span className="text-xs uppercase tracking-wide font-medium">{label}</span>
      </div>
      <p className="text-2xl font-bold text-primary">{value}</p>
      {sublabel && <p className="text-xs text-secondary mt-1">{sublabel}</p>}
    </button>
  );
}

export default function PurchaseDashboardPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['purchase-dashboard-summary'],
    queryFn: () => purchaseDashboardApi.summary(),
    staleTime: 60_000,
  });
  const summary = data as DashboardSummary | undefined;

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Purchase Dashboard"
        subtitle="Live procurement KPIs at a glance"
      />

      {isLoading || !summary ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 rounded-xl bg-surface-subtle animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              icon={ClipboardList}
              label="Pending Purchase Orders"
              value={String(summary.pendingPOCount)}
              sublabel={formatCurrency(parseFloat(summary.pendingPOValue))}
              onClick={() => navigate('/purchase/orders')}
            />
            <KpiCard
              icon={PackageCheck}
              label="Pending GRNs"
              value={String(summary.pendingGRNCount)}
              onClick={() => navigate('/purchase/grns')}
            />
            <KpiCard
              icon={Wallet}
              label="Supplier Outstanding"
              value={formatCurrency(parseFloat(summary.supplierOutstanding))}
              onClick={() => navigate('/purchase/payments')}
            />
            <KpiCard
              icon={TrendingUp}
              label="This Month's Purchases"
              value={formatCurrency(parseFloat(summary.thisMonthPurchaseTotal))}
            />
          </div>

          <div className="bg-surface-card rounded-xl border border-default p-5 mt-6">
            <h3 className="text-sm font-semibold text-primary mb-4">
              Top Suppliers (all-time, excl. draft/cancelled)
            </h3>
            {summary.topSuppliers.length === 0 ? (
              <p className="text-sm text-secondary">No purchase activity yet.</p>
            ) : (
              <ul className="divide-y divide-default">
                {summary.topSuppliers.map((s) => (
                  <li key={s.supplierId} className="flex justify-between py-2 text-sm">
                    <span className="text-primary">
                      {s.supplierName ?? `Supplier ${s.supplierId}`}
                    </span>
                    <span className="font-medium text-primary">
                      {formatCurrency(parseFloat(s.total))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
