import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  TrendingUp, ShoppingCart, Wallet, Package, AlertTriangle,
  Clock, Users, IndianRupee, BarChart3, RefreshCw,
} from 'lucide-react';
import { dashboardApi, salesDashboardApi } from '../api/endpoints.js';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../store/auth.store.js';
import { ERPCardSkeleton } from '../components/erp/ERPSkeleton.js';
import ERPStatCard from '../components/erp/ERPStatCard.js';
import ChartCard from '../components/erp/ChartCard.js';

const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#ec4899', '#14b8a6'];

function fmt(n: number | string | undefined | null): string {
  if (n === null || n === undefined) return '–';
  const num = Number(n);
  if (Number.isNaN(num)) return '–';
  if (num >= 1_00_000) return `₹${(num / 1_00_000).toFixed(2)}L`;
  if (num >= 1000) return `₹${(num / 1000).toFixed(1)}K`;
  return `₹${num.toFixed(0)}`;
}

function fmtNum(n: number | string | undefined | null): string {
  if (n === null || n === undefined) return '–';
  const num = Number(n);
  if (Number.isNaN(num)) return '–';
  return num.toLocaleString('en-IN');
}

interface KpiData {
  today_sales: number;
  today_collection: number;
  today_purchase: number;
  today_expense: number;
  month_sales: number;
  month_collection: number;
  month_profit: number;
  month_invoices: number;
}

interface AlertData {
  lowStock: { count: number };
  overdueReceivables: { count: number; total_amount: number };
  pendingPurchaseOrders: { count: number };
  pendingGRNs: { count: number };
  overduePayables: { count: number; total_amount: number };
}

interface ChartData {
  salesTrend: { date: string; total_sales: number; total_collections: number; gross_profit: number }[];
  salesByCategory: { category: string; revenue: number }[];
  paymentModes: { mode: string; total: number }[];
  stockByCategory: { category: string; value: number }[];
  monthlyComparison: { current_sales: number; prev_sales: number; current_profit: number; prev_profit: number };
  topCustomers: { name: string; revenue: number }[];
  receivablesAgeing: { bucket: string; amount: number }[];
  purchaseTrend: { date: string; total_purchases: number }[];
}

function AlertWidget({ icon: Icon, label, count, amount, color }: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  count: number;
  amount?: number;
  color: string;
}) {
  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border ${color}`}>
      <Icon size={18} className="mt-0.5 shrink-0" />
      <div>
        <p className="text-sm font-semibold">{count} {label}</p>
        {amount !== undefined && amount > 0 && (
          <p className="text-xs text-secondary">{fmt(amount)}</p>
        )}
      </div>
    </div>
  );
}

// Postgres NUMERIC/DECIMAL aggregates (SUM, COALESCE(SUM(...), 0), etc.) come back
// as strings over the wire to avoid float precision loss — Recharts scales and the
// fmt()/fmtNum() helpers below all need real numbers, so coerce at the fetch boundary.
function coerceNumericStrings<T>(value: T): T {
  if (Array.isArray(value)) return value.map(coerceNumericStrings) as unknown as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = coerceNumericStrings(v);
    return out as T;
  }
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
    return Number(value) as unknown as T;
  }
  return value;
}

const STALE_THRESHOLD_MS = 30_000;

function useDataStaleness(dataUpdatedAt: number): boolean {
  const [isStale, setIsStale] = useState(false);

  useEffect(() => {
    const check = () => setIsStale(Date.now() - dataUpdatedAt > STALE_THRESHOLD_MS);
    check();
    const id = setInterval(check, 5_000);
    return () => clearInterval(id);
  }, [dataUpdatedAt]);

  return isStale;
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);

  const { data: kpisRaw, dataUpdatedAt: kpisUpdatedAt, isLoading: isKpisLoading } = useQuery({
    queryKey: ['dashboard-kpis'],
    queryFn: async () => coerceNumericStrings(await dashboardApi.kpis()),
    refetchInterval: 30_000,
  });

  const { data: chartsRaw } = useQuery({
    queryKey: ['dashboard-charts'],
    queryFn: async () => coerceNumericStrings(await dashboardApi.charts()),
    staleTime: 60_000,
  });

  const { data: alertsRaw } = useQuery({
    queryKey: ['dashboard-alerts'],
    queryFn: async () => coerceNumericStrings(await dashboardApi.alerts()),
    refetchInterval: 60_000,
  });

  const { data: salesSummaryRaw } = useQuery({
    queryKey: ['dashboard-sales-summary'],
    queryFn: async () => coerceNumericStrings(await salesDashboardApi.summary()),
    refetchInterval: 60_000,
  });
  const salesSummary = (salesSummaryRaw as { pendingQuotations: number; overdueInvoices: number; collectedToday: number });

  const isStale = useDataStaleness(kpisUpdatedAt);

  const kpis = (kpisRaw as { today?: KpiData; balances?: { total_receivable: number; total_payable: number } } | undefined);
  const today = kpis?.today;
  const balances = kpis?.balances;
  const charts = chartsRaw as ChartData | undefined;
  const alerts = alertsRaw as AlertData | undefined;

  if (isKpisLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <ERPCardSkeleton key={i} lines={2} />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">Owner Dashboard</h1>
          <p className="text-sm text-secondary mt-0.5">Welcome back, {user?.firstName}. Here's today at a glance.</p>
        </div>
        <div className="flex items-center gap-2">
          {isStale && (
            <span className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 font-medium">
              <RefreshCw size={12} className="animate-spin" />
              Data may be stale
            </span>
          )}
          <div className="flex items-center gap-2 text-xs text-secondary border border-default rounded-lg px-3 py-1.5">
            <Clock size={13} />
            Live data · refreshes every 30s
          </div>
        </div>
      </div>

      {/* Today KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <ERPStatCard label="Today's Sales" value={fmt(today?.today_sales)} color="text-brand" />
        <ERPStatCard label="Today's Collection" value={fmt(today?.today_collection)} color="text-success" />
        <ERPStatCard label="Today's Purchase" value={fmt(today?.today_purchase)} color="text-warning" />
        <ERPStatCard label="Today's Expense" value={fmt(today?.today_expense)} color="text-error" />
      </div>

      {/* Month KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <ERPStatCard label="Month Sales" value={fmt(today?.month_sales)} sub="current month" trend="up" />
        <ERPStatCard label="Month Collection" value={fmt(today?.month_collection)} />
        <ERPStatCard label="Month Profit" value={fmt(today?.month_profit)} color="text-success" />
        <ERPStatCard label="Month Invoices" value={fmtNum(today?.month_invoices)} />
      </div>

      {/* Outstanding balances */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-surface-card border border-default rounded-xl p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-info-bg flex items-center justify-center shrink-0">
            <IndianRupee size={18} className="text-info" />
          </div>
          <div>
            <p className="text-xs text-secondary uppercase tracking-wide">Total Receivable</p>
            <p className="text-xl font-bold text-info">{fmt(balances?.total_receivable)}</p>
          </div>
        </div>
        <div className="bg-surface-card border border-default rounded-xl p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-warning-bg flex items-center justify-center shrink-0">
            <Wallet size={18} className="text-warning" />
          </div>
          <div>
            <p className="text-xs text-secondary uppercase tracking-wide">Total Payable</p>
            <p className="text-xl font-bold text-warning">{fmt(balances?.total_payable)}</p>
          </div>
        </div>
      </div>

      {/* Charts row 1: Sales trend + Category pie */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard title="Sales Trend (Last 30 Days)" icon={TrendingUp} wide>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={charts?.salesTrend ?? []} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`} />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="total_sales" name="Sales" stroke="#6366f1" fill="#6366f133" strokeWidth={2} />
              <Area type="monotone" dataKey="gross_profit" name="Profit" stroke="#22c55e" fill="#22c55e22" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Sales by Category" icon={BarChart3}>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={charts?.salesByCategory ?? []} dataKey="revenue" nameKey="category" cx="50%" cy="50%" outerRadius={70} label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={false} style={{ fontSize: 10 }}>
                {(charts?.salesByCategory ?? []).map((_entry, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v: number) => fmt(v)} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Charts row 2: Ageing + Payment modes + Top customers */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ChartCard title="Receivables Ageing" icon={AlertTriangle} iconClassName="text-warning">
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={charts?.receivablesAgeing ?? []} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
              <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`} />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Bar dataKey="amount" fill="#ef4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Payment Modes" icon={Wallet}>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={charts?.paymentModes ?? []} dataKey="total" nameKey="mode" cx="50%" cy="50%" outerRadius={60} label={({ name }) => name}>
                {(charts?.paymentModes ?? []).map((_e, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v: number) => fmt(v)} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Top Customers" icon={Users}>
          <div className="space-y-2">
            {(charts?.topCustomers ?? []).map((c, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-primary truncate max-w-[150px]">{c.name}</span>
                <span className="text-secondary font-medium shrink-0">{fmt(c.revenue)}</span>
              </div>
            ))}
            {!charts?.topCustomers?.length && (
              <p className="text-secondary text-sm">No data yet</p>
            )}
          </div>
        </ChartCard>
      </div>

      {/* Charts row 3: Purchase trend + Stock by category */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Purchase Trend (Last 30 Days)" icon={ShoppingCart} iconClassName="text-warning">
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={charts?.purchaseTrend ?? []} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`} />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Area type="monotone" dataKey="total_purchases" name="Purchases" stroke="#f59e0b" fill="#f59e0b22" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Stock Value by Category" icon={Package}>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={charts?.stockByCategory ?? []} layout="vertical" margin={{ top: 0, right: 8, left: 60, bottom: 0 }}>
              <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`} />
              <YAxis type="category" dataKey="category" tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Bar dataKey="value" fill="#6366f1" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Sales Workflow Summary */}
      <div>
        <h3 className="text-sm font-semibold text-primary mb-3">Sales Workflow</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link to="/sales/quotations?status=SENT" className="block bg-surface-card border border-default rounded-xl p-4 hover:border-warning transition-colors">
            <p className="text-xs text-secondary uppercase tracking-wide mb-1">Pending Quotations</p>
            <p className="text-2xl font-bold text-warning">{salesSummary?.pendingQuotations ?? '–'}</p>
            <p className="text-xs text-secondary mt-1">SENT &gt; 3 days, awaiting acceptance</p>
          </Link>
          <Link to="/sales/invoices?status=OVERDUE" className="block bg-surface-card border border-default rounded-xl p-4 hover:border-error transition-colors">
            <p className="text-xs text-secondary uppercase tracking-wide mb-1">Overdue Invoices</p>
            <p className="text-2xl font-bold text-error">{salesSummary?.overdueInvoices ?? '–'}</p>
            <p className="text-xs text-secondary mt-1">Past due date, payment not received</p>
          </Link>
          <Link to="/sales/payments" className="block bg-surface-card border border-default rounded-xl p-4 hover:border-success transition-colors">
            <p className="text-xs text-secondary uppercase tracking-wide mb-1">Collected Today</p>
            <p className="text-2xl font-bold text-success">
              {salesSummary ? fmt(salesSummary.collectedToday) : '–'}
            </p>
            <p className="text-xs text-secondary mt-1">Total payments recorded today</p>
          </Link>
        </div>
      </div>

      {/* Alert widgets */}
      <div>
        <h3 className="text-sm font-semibold text-primary mb-3">Action Required</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {(alerts?.lowStock?.count ?? 0) > 0 && (
            <AlertWidget icon={Package} label="items below reorder level" count={alerts!.lowStock.count}
              color="border-warning bg-warning-bg text-warning" />
          )}
          {(alerts?.overdueReceivables.count ?? 0) > 0 && (
            <AlertWidget icon={AlertTriangle} label="overdue receivables" count={alerts!.overdueReceivables.count}
              amount={alerts!.overdueReceivables.total_amount} color="border-error bg-error-bg text-error" />
          )}
          {(alerts?.overduePayables.count ?? 0) > 0 && (
            <AlertWidget icon={AlertTriangle} label="overdue payables" count={alerts!.overduePayables.count}
              amount={alerts!.overduePayables.total_amount} color="border-orange-400 dark:border-orange-700 bg-orange-50 text-orange-600 dark:bg-orange-900/20 dark:text-orange-400" />
          )}
          {(alerts?.pendingPurchaseOrders.count ?? 0) > 0 && (
            <AlertWidget icon={ShoppingCart} label="pending purchase orders" count={alerts!.pendingPurchaseOrders.count}
              color="border-info bg-info-bg text-info" />
          )}
          {(alerts?.pendingGRNs.count ?? 0) > 0 && (
            <AlertWidget icon={Clock} label="GRNs pending approval" count={alerts!.pendingGRNs.count}
              color="border-default bg-surface-raised text-secondary" />
          )}
          {!alerts && (
            <p className="text-secondary text-sm col-span-full">Loading alerts...</p>
          )}
          {alerts && Object.values({
            a: alerts.lowStock.count,
            b: alerts.overdueReceivables.count,
            c: alerts.overduePayables.count,
            d: alerts.pendingPurchaseOrders.count,
            e: alerts.pendingGRNs.count,
          }).every((v) => v === 0) && (
            <p className="text-success text-sm col-span-full font-medium">All clear — no action items today!</p>
          )}
        </div>
      </div>
    </div>
  );
}
