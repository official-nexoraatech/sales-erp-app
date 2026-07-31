import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPErrorBoundary from '../../components/erp/ERPErrorBoundary.js';
import { ERPCardSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPDateRangePicker from '../../components/erp/ERPDateRangePicker.js';
import { reportsEngineApi } from '../../api/endpoints.js';

function fmt(n: number | undefined | null): string {
  if (n === null || n === undefined) return '–';
  if (n >= 1_00_000) return `₹${(n / 1_00_000).toFixed(2)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
}

interface PurchaseTrendRow {
  month: string;
  grnCount: number | string;
  spend: number | string;
  priceVarianceCount: number | string;
}

interface SupplierPerformanceRow {
  supplierName: string;
  grnCount: number | string;
  totalPurchased: number | string;
  onTimeDeliveryPct: number | string | null;
  priceVariancePct: number | string;
  returnRatePct: number | string;
}

function defaultFromDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 11);
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

export default function PurchaseAnalyticsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState(defaultFromDate());
  const [toDate, setToDate] = useState(today);

  const { data: trendData, isLoading: trendLoading } = useQuery({
    queryKey: ['purchase-analytics', fromDate, toDate],
    queryFn: async () =>
      (await reportsEngineApi.run('purchase-analytics', { fromDate, toDate })) as {
        rows: PurchaseTrendRow[];
      },
  });

  const { data: perfData, isLoading: perfLoading } = useQuery({
    queryKey: ['supplier-performance', fromDate, toDate],
    queryFn: async () =>
      (await reportsEngineApi.run('supplier-performance', { fromDate, toDate })) as {
        rows: SupplierPerformanceRow[];
      },
  });

  const trend = (trendData?.rows ?? []).map((r) => ({
    month: r.month,
    spend: Number(r.spend),
    grnCount: Number(r.grnCount),
    priceVarianceCount: Number(r.priceVarianceCount),
  }));
  const suppliers = (perfData?.rows ?? [])
    .map((r) => ({
      supplierName: r.supplierName,
      grnCount: Number(r.grnCount),
      totalPurchased: Number(r.totalPurchased),
      onTimeDeliveryPct: r.onTimeDeliveryPct === null ? null : Number(r.onTimeDeliveryPct),
      priceVariancePct: Number(r.priceVariancePct),
      returnRatePct: Number(r.returnRatePct),
    }))
    .sort((a, b) => b.totalPurchased - a.totalPurchased);

  const totalSpend = trend.reduce((s, t) => s + t.spend, 0);
  const totalGrns = trend.reduce((s, t) => s + t.grnCount, 0);
  const totalVariance = trend.reduce((s, t) => s + t.priceVarianceCount, 0);
  const variancePct = totalGrns > 0 ? ((totalVariance / totalGrns) * 100).toFixed(1) : '0.0';

  const isLoading = trendLoading || perfLoading;

  return (
    <ERPErrorBoundary>
      <div className="space-y-4">
        <ERPPageHeader
          variant="list"
          title="Purchase Analytics"
          subtitle="Spend trend, GRN volume, and supplier performance"
          actions={
            <ERPDateRangePicker
              value={{ from: fromDate, to: toDate }}
              onChange={(range) => {
                setFromDate(range.from);
                setToDate(range.to);
              }}
            />
          }
        />

        {isLoading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <ERPCardSkeleton key={i} lines={4} />
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-surface-card rounded-xl border border-default p-4">
                <div className="text-xs text-secondary">Total Spend (period)</div>
                <div className="text-xl font-semibold mt-1">{fmt(totalSpend)}</div>
              </div>
              <div className="bg-surface-card rounded-xl border border-default p-4">
                <div className="text-xs text-secondary">GRNs Received</div>
                <div className="text-xl font-semibold mt-1">{totalGrns}</div>
              </div>
              <div className="bg-surface-card rounded-xl border border-default p-4">
                <div className="text-xs text-secondary">Price Variance Rate</div>
                <div className="text-xl font-semibold mt-1">{variancePct}%</div>
              </div>
            </div>

            <div className="bg-surface-card border border-default rounded-xl p-4">
              <h3 className="text-sm font-semibold text-primary mb-3">Monthly Purchase Spend</h3>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmt(v)} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line
                    type="monotone"
                    dataKey="spend"
                    name="Spend"
                    stroke="var(--chart-1)"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-surface-card border border-default rounded-xl p-4">
              <h3 className="text-sm font-semibold text-primary mb-3">Supplier Performance</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-secondary uppercase border-b border-default">
                      <th className="px-3 py-2">Supplier</th>
                      <th className="px-3 py-2 text-right">GRNs</th>
                      <th className="px-3 py-2 text-right">Total Purchased</th>
                      <th className="px-3 py-2 text-right">On-Time Delivery</th>
                      <th className="px-3 py-2 text-right">Price Variance</th>
                      <th className="px-3 py-2 text-right">Return Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suppliers.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-center text-secondary">
                          No data for this period
                        </td>
                      </tr>
                    ) : (
                      suppliers.map((s, i) => (
                        <tr key={i} className="border-b border-default/50">
                          <td className="px-3 py-2 text-primary">{s.supplierName}</td>
                          <td className="px-3 py-2 text-right font-mono">{s.grnCount}</td>
                          <td className="px-3 py-2 text-right font-mono">
                            {fmt(s.totalPurchased)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {s.onTimeDeliveryPct === null ? '—' : `${s.onTimeDeliveryPct}%`}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">{s.priceVariancePct}%</td>
                          <td className="px-3 py-2 text-right font-mono">{s.returnRatePct}%</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </ERPErrorBoundary>
  );
}
