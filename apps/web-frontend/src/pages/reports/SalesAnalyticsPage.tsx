import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPErrorBoundary from '../../components/erp/ERPErrorBoundary.js';
import { ERPCardSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPDateRangePicker from '../../components/erp/ERPDateRangePicker.js';
import { reportsEngineApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';

const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#ec4899', '#14b8a6'];

function fmt(n: number | undefined | null): string {
  if (n === null || n === undefined) return '–';
  if (n >= 1_00_000) return `₹${(n / 1_00_000).toFixed(2)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
}

interface RevenueTrendRow { month: string; invoiceCount: number | string; revenue: number | string; }
interface CustomerRow { customerName: string; totalSales: number | string; }
interface CategoryRow { category: string; revenue: number | string; }
interface SalespersonRow { salesperson: string; invoiceCount: number | string; revenue: number | string; }

function defaultFromDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 11);
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

export default function SalesAnalyticsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState(defaultFromDate());
  const [toDate, setToDate] = useState(today);
  const canViewInvoices = useAuthStore((s) => s.hasPermission(PERMISSIONS.INVOICE_VIEW));

  const { data: trendData, isLoading: trendLoading } = useQuery({
    queryKey: ['sales-revenue-trend', fromDate, toDate],
    queryFn: async () => (await reportsEngineApi.run('sales-revenue-trend', { fromDate, toDate })) as { rows: RevenueTrendRow[] },
  });

  const { data: customerData, isLoading: customerLoading } = useQuery({
    queryKey: ['sales-by-customer', fromDate, toDate],
    queryFn: async () => (await reportsEngineApi.run('sales-by-customer', { fromDate, toDate })) as { rows: CustomerRow[] },
    enabled: canViewInvoices,
  });

  const { data: categoryData, isLoading: categoryLoading } = useQuery({
    queryKey: ['sales-by-category', fromDate, toDate],
    queryFn: async () => (await reportsEngineApi.run('sales-by-category', { fromDate, toDate })) as { rows: CategoryRow[] },
    enabled: canViewInvoices,
  });

  const { data: salespersonData, isLoading: salespersonLoading } = useQuery({
    queryKey: ['sales-by-salesperson', fromDate, toDate],
    queryFn: async () => (await reportsEngineApi.run('sales-by-salesperson', { fromDate, toDate })) as { rows: SalespersonRow[] },
    enabled: canViewInvoices,
  });

  const trend = (trendData?.rows ?? []).map((r) => ({ month: r.month, revenue: Number(r.revenue), invoiceCount: Number(r.invoiceCount) }));
  const topCustomers = (customerData?.rows ?? [])
    .map((r) => ({ customerName: r.customerName, totalSales: Number(r.totalSales) }))
    .sort((a, b) => b.totalSales - a.totalSales)
    .slice(0, 10);
  const categories = (categoryData?.rows ?? []).map((r) => ({ category: r.category, revenue: Number(r.revenue) }));
  const salespeople = (salespersonData?.rows ?? []).map((r) => ({
    salesperson: r.salesperson,
    invoiceCount: Number(r.invoiceCount),
    revenue: Number(r.revenue),
  }));

  const isLoading = trendLoading || customerLoading || categoryLoading || salespersonLoading;

  return (
    <ERPErrorBoundary>
      <div className="space-y-4">
        <ERPPageHeader
          variant="list"
          title="Sales Analytics"
          subtitle="Revenue trend, top customers, category and salesperson performance"
          actions={
            <ERPDateRangePicker
              value={{ from: fromDate, to: toDate }}
              onChange={(range) => { setFromDate(range.from); setToDate(range.to); }}
            />
          }
        />

        {isLoading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <ERPCardSkeleton key={i} lines={4} />)}
          </div>
        ) : (
          <>
            <div className="bg-surface-card border border-default rounded-xl p-4">
              <h3 className="text-sm font-semibold text-primary mb-3">Monthly Revenue Trend</h3>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmt(v)} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="revenue" name="Revenue" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-surface-card border border-default rounded-xl p-4">
                <h3 className="text-sm font-semibold text-primary mb-3">Top 10 Customers by Revenue</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={topCustomers} layout="vertical" margin={{ top: 0, right: 16, left: 80, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => fmt(v)} />
                    <YAxis type="category" dataKey="customerName" tick={{ fontSize: 10 }} width={90} />
                    <Tooltip formatter={(v: number) => fmt(v)} />
                    <Bar dataKey="totalSales" name="Revenue" fill="#6366f1" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-surface-card border border-default rounded-xl p-4">
                <h3 className="text-sm font-semibold text-primary mb-3">Category-wise Sales</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={categories}
                      dataKey="revenue"
                      nameKey="category"
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                      labelLine={false}
                      style={{ fontSize: 10 }}
                    >
                      {categories.map((_entry, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => fmt(v)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-surface-card border border-default rounded-xl p-4">
              <h3 className="text-sm font-semibold text-primary mb-3">Salesperson Performance</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-secondary uppercase border-b border-default">
                      <th className="px-3 py-2">Salesperson</th>
                      <th className="px-3 py-2 text-right">Invoices</th>
                      <th className="px-3 py-2 text-right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salespeople.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-3 py-6 text-center text-secondary">No data for this period</td>
                      </tr>
                    ) : (
                      salespeople.map((s, i) => (
                        <tr key={i} className="border-b border-default/50">
                          <td className="px-3 py-2 text-primary">{s.salesperson}</td>
                          <td className="px-3 py-2 text-right font-mono">{s.invoiceCount}</td>
                          <td className="px-3 py-2 text-right font-mono">{fmt(s.revenue)}</td>
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
