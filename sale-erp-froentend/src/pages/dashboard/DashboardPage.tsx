import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownCircle,
  ArrowUp,
  ArrowUpCircle,
  CheckCircle2,
  CircleDollarSign,
  PackageSearch,
  ShoppingBag,
  ShoppingCart,
  Tags,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
  BarChart2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  dashboardApi,
  expenseApi,
  purchaseApi,
  reportsApi,
  salesApi,
} from '../../api/endpoints';
import { PERMISSIONS } from '../../auth/permissions';
import { useAuth } from '../../hooks/useAuth';
import type {
  DashboardLowStockItem,
  DashboardRecentInvoice,
  DashboardTrendPoint,
  DashboardTrendingItem,
  PurchaseListItem,
  SaleListItem,
} from '../../types/api.types';
import { formatCurrency } from '../../utils/formatCurrency';
import { formatDate } from '../../utils/formatDate';

const TREND_COLORS = ['#f70768', '#ff5b16', '#5856d6', '#16a8e2', '#22c55e', '#f5b800'];

const numberValue = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const isCompleted = (status?: string, balance?: number) => {
  const normalized = status?.toUpperCase() || '';
  return ['PAID', 'COMPLETED', 'COMPLETE', 'CLOSED'].includes(normalized) || numberValue(balance) <= 0;
};

const monthKey = (value: string | Date) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

const lastSixMonths = () => {
  const result: Array<{ key: string; label: string }> = [];
  const now = new Date();
  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    result.push({
      key: monthKey(date),
      label: date.toLocaleDateString('en-IN', { month: 'short' }),
    });
  }
  return result;
};

const metricValue = (value: number, currency = false) =>
  currency ? formatCurrency(numberValue(value)) : numberValue(value).toLocaleString('en-IN');

/* ── Metric Card ── */
interface MetricCardProps {
  title: string;
  value: number;
  color: string;
  icon: React.ReactNode;
  currency?: boolean;
  subLabel?: string;
}

const MetricCard: React.FC<MetricCardProps> = ({ title, value, color, icon, currency = false, subLabel }) => (
  <div
    className="flex min-h-[88px] items-center justify-between rounded-xl bg-white px-4 py-3 shadow-[0_2px_10px_rgba(79,70,229,0.10)] dark:bg-[#111827]"
  >
    <div>
      <p className="max-w-[130px] text-[11px] leading-5 text-slate-500 dark:text-slate-400">{title}</p>
      <p className="mt-0.5 text-[19px] font-bold leading-tight" style={{ color }}>{metricValue(value, currency)}</p>
      {subLabel && <p className="mt-0.5 text-[10px] text-slate-400">{subLabel}</p>}
    </div>
    <div
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white shadow"
      style={{ background: `linear-gradient(145deg, ${color}, ${color}bb)` }}
    >
      {icon}
    </div>
  </div>
);

/* ── Today Card (smaller compact variant) ── */
interface TodayCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  currency?: boolean;
}

const TodayCard: React.FC<TodayCardProps> = ({ label, value, icon, color, currency = true }) => (
  <div className="flex items-center gap-3 rounded-xl bg-white px-4 py-3 shadow-[0_1px_8px_rgba(79,70,229,0.09)] dark:bg-[#111827]">
    <div
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white"
      style={{ background: color }}
    >
      {icon}
    </div>
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{currency ? formatCurrency(value) : value.toLocaleString('en-IN')}</p>
    </div>
  </div>
);

/* ── Panel ── */
const Panel: React.FC<React.PropsWithChildren<{ title: string; action?: React.ReactNode; className?: string }>> = ({
  title, action, className = '', children,
}) => (
  <section className={`overflow-hidden rounded-xl bg-white shadow-[0_2px_10px_rgba(79,70,229,0.10)] dark:bg-[#111827] ${className}`}>
    <div className="flex min-h-11 items-center justify-between border-b border-slate-100 px-4 py-2.5 dark:border-slate-700">
      <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</h2>
      {action}
    </div>
    {children}
  </section>
);

const ViewAllButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button type="button" onClick={onClick} className="rounded border border-sky-400 px-2 py-1 text-[11px] font-medium text-sky-600 transition hover:bg-sky-50">
    View All
  </button>
);

/* ═══════════════════════════════════════════════════════
   MAIN PAGE
═══════════════════════════════════════════════════════ */
export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const months = useMemo(lastSixMonths, []);
  const fromDate = `${months[0].key}-01`;
  const toDate = new Date().toISOString().slice(0, 10);

  const canViewDashboard   = hasPermission(PERMISSIONS.DASHBOARD_VIEW);
  const canViewSales       = hasPermission(PERMISSIONS.SALES_VIEW);
  const canViewPurchases   = hasPermission(PERMISSIONS.PURCHASE_VIEW);
  const canViewExpenses    = hasPermission(PERMISSIONS.EXPENSE_VIEW);
  const canViewLowStock    = hasPermission(PERMISSIONS.REPORT_LOW_STOCK_VIEW);
  const canViewTopItems    = hasPermission(PERMISSIONS.REPORT_TOP_SELLING_ITEMS_VIEW);

  const summaryQuery   = useQuery({ queryKey: ['dashboard-summary'], queryFn: dashboardApi.getSummary, enabled: canViewDashboard, retry: false });
  const salesQuery     = useQuery({ queryKey: ['dashboard-sales', fromDate, toDate], queryFn: () => salesApi.getAll({ page: 0, size: 200, fromDate, toDate }), enabled: canViewSales, retry: false });
  const purchasesQuery = useQuery({ queryKey: ['dashboard-purchases', fromDate, toDate], queryFn: () => purchaseApi.getAll({ page: 0, size: 200, fromDate, toDate }), enabled: canViewPurchases, retry: false });
  const expensesQuery  = useQuery({ queryKey: ['dashboard-expenses', fromDate, toDate], queryFn: () => expenseApi.getAll({ page: 0, size: 200, fromDate, toDate }), enabled: canViewExpenses, retry: false });
  const lowStockQuery  = useQuery({ queryKey: ['dashboard-low-stock'], queryFn: reportsApi.lowStock, enabled: canViewLowStock, retry: false });
  const topItemsQuery  = useQuery({ queryKey: ['dashboard-top-selling-items'], queryFn: reportsApi.topSellingItems, enabled: canViewTopItems, retry: false });

  const summary   = summaryQuery.data?.data;
  const sales     = salesQuery.data?.data?.content || [];
  const purchases = purchasesQuery.data?.data?.content || [];
  const expenses  = expensesQuery.data?.data?.content || [];

  /* ── Metrics ── */
  const metrics = useMemo(() => {
    const pendingSales       = sales.filter((s) => !isCompleted(s.status, s.dueAmount)).length;
    const completedSales     = sales.filter((s) => isCompleted(s.status, s.dueAmount)).length;
    const pendingPurchases   = purchases.filter((p) => !isCompleted(p.status, p.dueAmount)).length;
    const completedPurchases = purchases.filter((p) => isCompleted(p.status, p.dueAmount)).length;
    return {
      pendingSaleOrders:      summary?.pendingSaleOrders      ?? pendingSales,
      completedSaleOrders:    summary?.completedSaleOrders    ?? completedSales,
      paymentReceivables:     summary?.paymentReceivables     ?? sales.reduce((t, s) => t + numberValue(s.dueAmount), 0),
      paymentPayables:        summary?.paymentPayables        ?? purchases.reduce((t, p) => t + numberValue(p.dueAmount), 0),
      pendingPurchaseOrders:  summary?.pendingPurchaseOrders  ?? pendingPurchases,
      completedPurchaseOrders:summary?.completedPurchaseOrders?? completedPurchases,
      totalExpense:           summary?.totalExpense ?? summary?.todayExpense ?? expenses.reduce((t, e) => t + numberValue(e.amount), 0),
      totalCustomers:         summary?.totalCustomers         ?? 0,
      totalSuppliers:         summary?.totalSuppliers         ?? 0,
    };
  }, [expenses, purchases, sales, summary]);

  /* ── Extended financial metrics ── */
  const financialMetrics = useMemo(() => {
    const totalRevenue   = sales.reduce((t, s) => t + numberValue(s.grandTotal), 0);
    const totalCost      = purchases.reduce((t, p) => t + numberValue(p.grandTotal), 0);
    const totalExpenses  = expenses.reduce((t, e) => t + numberValue(e.amount), 0);
    const netProfit      = totalRevenue - totalCost - totalExpenses;
    const paidSalesAmt   = sales.filter((s) => isCompleted(s.status, s.dueAmount)).reduce((t, s) => t + numberValue(s.grandTotal), 0);
    const unpaidSalesAmt = sales.filter((s) => !isCompleted(s.status, s.dueAmount)).reduce((t, s) => t + numberValue(s.dueAmount), 0);
    const paidSalesCount   = sales.filter((s) => isCompleted(s.status, s.dueAmount)).length;
    const unpaidSalesCount = sales.filter((s) => !isCompleted(s.status, s.dueAmount)).length;
    const paidPurchAmt   = purchases.filter((p) => isCompleted(p.status, p.dueAmount)).reduce((t, p) => t + numberValue(p.grandTotal), 0);
    const unpaidPurchAmt = purchases.filter((p) => !isCompleted(p.status, p.dueAmount)).reduce((t, p) => t + numberValue(p.dueAmount), 0);
    return { totalRevenue, totalCost, totalExpenses, netProfit, paidSalesAmt, unpaidSalesAmt, paidSalesCount, unpaidSalesCount, paidPurchAmt, unpaidPurchAmt };
  }, [sales, purchases, expenses]);

  /* ── Today stats ── */
  const todayStats = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    return {
      sales:      summary?.todaySales      ?? sales.filter((s) => s.invoiceDate?.startsWith(todayStr)).reduce((t, s) => t + numberValue(s.grandTotal), 0),
      purchase:   summary?.todayPurchase   ?? purchases.filter((p) => p.purchaseDate?.startsWith(todayStr)).reduce((t, p) => t + numberValue(p.grandTotal), 0),
      expense:    summary?.todayExpense    ?? expenses.filter((e) => e.expenseDate?.startsWith(todayStr)).reduce((t, e) => t + numberValue(e.amount), 0),
      collection: summary?.todayCollection ?? sales.filter((s) => s.invoiceDate?.startsWith(todayStr) && isCompleted(s.status, s.dueAmount)).reduce((t, s) => t + numberValue(s.grandTotal), 0),
    };
  }, [summary, sales, purchases, expenses]);

  /* ── Sale vs Purchase chart ── */
  const chartData = useMemo(() => {
    if (summary?.saleVsPurchase?.length) {
      return summary.saleVsPurchase.map((entry: DashboardTrendPoint) => ({
        month:     entry.label || entry.month || entry.period || '',
        sales:     numberValue(entry.sales ?? entry.saleAmount),
        purchases: numberValue(entry.purchases ?? entry.purchaseAmount),
      }));
    }
    const grouped = new Map(months.map((m) => [m.key, { month: m.label, sales: 0, purchases: 0 }]));
    sales.forEach((s) => { const e = grouped.get(monthKey(s.invoiceDate)); if (e) e.sales += numberValue(s.grandTotal); });
    purchases.forEach((p) => { const e = grouped.get(monthKey(p.purchaseDate)); if (e) e.purchases += numberValue(p.grandTotal); });
    return [...grouped.values()];
  }, [months, purchases, sales, summary?.saleVsPurchase]);

  /* ── Expense trend chart ── */
  const expenseTrendData = useMemo(() => {
    const grouped = new Map(months.map((m) => [m.key, { month: m.label, expense: 0 }]));
    expenses.forEach((e) => {
      const entry = grouped.get(monthKey(e.expenseDate || ''));
      if (entry) entry.expense += numberValue(e.amount);
    });
    return [...grouped.values()];
  }, [months, expenses]);

  /* ── Net Profit trend ── */
  const profitTrendData = useMemo(() => {
    const grouped = new Map(months.map((m) => [m.key, { month: m.label, revenue: 0, cost: 0, expense: 0 }]));
    sales.forEach((s) => { const e = grouped.get(monthKey(s.invoiceDate)); if (e) e.revenue += numberValue(s.grandTotal); });
    purchases.forEach((p) => { const e = grouped.get(monthKey(p.purchaseDate)); if (e) e.cost += numberValue(p.grandTotal); });
    expenses.forEach((ex) => { const e = grouped.get(monthKey(ex.expenseDate || '')); if (e) e.expense += numberValue(ex.amount); });
    return [...grouped.values()].map((m) => ({ ...m, profit: m.revenue - m.cost - m.expense }));
  }, [months, sales, purchases, expenses]);

  /* ── Sales payment status for pie ── */
  const salesPaymentStatus = useMemo(() => [
    { name: 'Collected', value: financialMetrics.paidSalesAmt, count: financialMetrics.paidSalesCount, color: '#22c55e' },
    { name: 'Outstanding', value: financialMetrics.unpaidSalesAmt, count: financialMetrics.unpaidSalesCount, color: '#ff3d5a' },
  ], [financialMetrics]);

  /* ── Purchase payment status for pie ── */
  const purchasePaymentStatus = useMemo(() => [
    { name: 'Paid', value: financialMetrics.paidPurchAmt, color: '#22c55e' },
    { name: 'Unpaid', value: financialMetrics.unpaidPurchAmt, color: '#ff9f0a' },
  ], [financialMetrics]);

  /* ── Trending items ── */
  const trendingItems = useMemo<DashboardTrendingItem[]>(() => {
    if (summary?.trendingItems?.length) return summary.trendingItems.slice(0, 6);
    return (topItemsQuery.data?.data || []).slice(0, 6).map((item) => ({
      itemId: item.itemId, itemName: item.itemName,
      quantity: numberValue(item.quantity), totalAmount: numberValue(item.totalAmount),
    }));
  }, [summary?.trendingItems, topItemsQuery.data?.data]);

  /* ── Recent invoices ── */
  const recentInvoices = useMemo<DashboardRecentInvoice[]>(() => {
    if (summary?.recentInvoices?.length) return summary.recentInvoices.slice(0, 6);
    return [...sales]
      .sort((a, b) => new Date(b.invoiceDate).getTime() - new Date(a.invoiceDate).getTime())
      .slice(0, 6)
      .map((sale: SaleListItem) => ({
        saleId: sale.saleId, invoiceDate: sale.invoiceDate, saleCode: sale.invoiceNo,
        customerName: sale.customerName, grandTotal: numberValue(sale.grandTotal),
        balance: numberValue(sale.dueAmount),
        status: isCompleted(sale.status, sale.dueAmount) ? 'PAID' : sale.status || 'DUE',
      }));
  }, [sales, summary?.recentInvoices]);

  /* ── Recent purchases ── */
  const recentPurchases = useMemo(() =>
    [...purchases]
      .sort((a, b) => new Date(b.purchaseDate).getTime() - new Date(a.purchaseDate).getTime())
      .slice(0, 6)
      .map((p: PurchaseListItem) => ({
        purchaseId: p.purchaseId, purchaseDate: p.purchaseDate,
        supplierName: p.supplierName, grandTotal: numberValue(p.grandTotal),
        dueAmount: numberValue(p.dueAmount),
        status: isCompleted(p.status, p.dueAmount) ? 'PAID' : p.status || 'DUE',
      })),
    [purchases]);

  /* ── Low stock ── */
  const lowStockItems = useMemo<DashboardLowStockItem[]>(() => {
    if (summary?.lowStockDetails?.length) return summary.lowStockDetails.slice(0, 6);
    if (Array.isArray(summary?.lowStockItems)) return (summary.lowStockItems as DashboardLowStockItem[]).slice(0, 6);
    return (lowStockQuery.data?.data || []).slice(0, 6).map((item) => ({
      itemId: item.itemId, itemName: item.itemName, brand: item.brandName || '',
      category: item.categoryName || 'General',
      minimumStock: numberValue(item.reorderLevel), currentStock: numberValue(item.availableQty),
      unit: item.unitName || '',
    }));
  }, [lowStockQuery.data?.data, summary?.lowStockDetails, summary?.lowStockItems]);

  const hasAnyError = [summaryQuery, salesQuery, purchasesQuery, expensesQuery, lowStockQuery, topItemsQuery].some((q) => q.isError);

  if (!canViewDashboard) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
        Your account does not have the <strong>DASHBOARD_VIEW</strong> permission.
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {hasAnyError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          Some dashboard sections could not be loaded. Available information is shown below.
        </div>
      )}

      {/* ── Today at a Glance ── */}
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Today at a Glance</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <TodayCard label="Today's Sales"      value={todayStats.sales}      icon={<ShoppingCart size={18} />}       color="#1684ed" />
          <TodayCard label="Today's Purchase"   value={todayStats.purchase}   icon={<ShoppingBag size={18} />}        color="#f5b800" />
          <TodayCard label="Today's Collection" value={todayStats.collection} icon={<CircleDollarSign size={18} />}  color="#22c55e" />
          <TodayCard label="Today's Expense"    value={todayStats.expense}    icon={<TrendingDown size={18} />}       color="#ef4444" />
        </div>
      </div>

      {/* ── 8 Metric Cards ── */}
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Business Overview</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard title="Pending Sale Orders"       value={metrics.pendingSaleOrders}       color="#18baf0" icon={<ShoppingCart size={20} />} />
          <MetricCard title="Completed Sale Orders"     value={metrics.completedSaleOrders}     color="#20bf55" icon={<CheckCircle2 size={20} />} />
          <MetricCard title="Payment Receivables"       value={metrics.paymentReceivables}      color="#ff3d5a" icon={<ArrowDownCircle size={20} />} currency />
          <MetricCard title="Payment Payables"          value={metrics.paymentPayables}         color="#ff9f0a" icon={<ArrowUpCircle size={20} />} currency />
          <MetricCard title="Pending Purchase Orders"   value={metrics.pendingPurchaseOrders}   color="#27aee9" icon={<Tags size={20} />} />
          <MetricCard title="Completed Purchase Orders" value={metrics.completedPurchaseOrders} color="#13b981" icon={<CheckCircle2 size={20} />} />
          <MetricCard title="Total Customers"           value={metrics.totalCustomers}          color="#ff7a12" icon={<Users size={20} />} />
          <MetricCard title="Total Suppliers"           value={metrics.totalSuppliers}          color="#8b5cf6" icon={<Users size={20} />} />
        </div>
      </div>

      {/* ── Financial Performance Cards ── */}
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Financial Performance (Last 6 Months)</p>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <MetricCard title="Total Revenue" value={financialMetrics.totalRevenue} color="#1684ed" icon={<Wallet size={20} />} currency />
          <MetricCard title="Total Purchase Cost" value={financialMetrics.totalCost} color="#f5b800" icon={<ShoppingBag size={20} />} currency />
          <MetricCard title="Total Expenses" value={financialMetrics.totalExpenses} color="#ef4444" icon={<TrendingDown size={20} />} currency />
          <MetricCard
            title="Net Profit"
            value={financialMetrics.netProfit}
            color={financialMetrics.netProfit >= 0 ? '#22c55e' : '#ef4444'}
            icon={<BarChart2 size={20} />}
            currency
            subLabel={financialMetrics.netProfit >= 0 ? 'Profitable' : 'Loss'}
          />
        </div>
      </div>

      {/* ── Charts Row ── */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Panel title="Sale vs. Purchase — Last 6 Months" className="xl:col-span-2">
          <div className="h-[280px] p-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} width={52} axisLine={false} tickLine={false} />
                <Tooltip formatter={(value) => formatCurrency(numberValue(value))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar name="Purchase Bills" dataKey="purchases" fill="#f5b800" radius={[6, 6, 0, 0]} maxBarSize={20} />
                <Bar name="Sale Invoices"  dataKey="sales"     fill="#1684ed" radius={[6, 6, 0, 0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Monthly Expense Trend">
          <div className="h-[280px] p-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={expenseTrendData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="expenseGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} width={52} axisLine={false} tickLine={false} />
                <Tooltip formatter={(value) => formatCurrency(numberValue(value))} />
                <Area type="monotone" dataKey="expense" name="Expense" stroke="#ef4444" strokeWidth={2} fill="url(#expenseGrad)" dot={{ r: 3, fill: '#ef4444' }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      {/* ── Net Profit Trend + Payment Status Charts ── */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Panel title="Net Profit Trend — Last 6 Months" className="xl:col-span-2">
          <div className="h-[260px] p-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={profitTrendData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} width={52} axisLine={false} tickLine={false} />
                <Tooltip formatter={(value) => formatCurrency(numberValue(value))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line name="Revenue" type="monotone" dataKey="revenue" stroke="#1684ed" strokeWidth={2} dot={{ r: 3, fill: '#1684ed' }} />
                <Line name="Purchase Cost" type="monotone" dataKey="cost" stroke="#f5b800" strokeWidth={2} dot={{ r: 3, fill: '#f5b800' }} />
                <Line name="Expenses" type="monotone" dataKey="expense" stroke="#ef4444" strokeWidth={2} dot={{ r: 3, fill: '#ef4444' }} />
                <Line name="Net Profit" type="monotone" dataKey="profit" stroke="#22c55e" strokeWidth={2.5} strokeDasharray="5 3" dot={{ r: 3, fill: '#22c55e' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <div className="flex flex-col gap-5">
          <Panel title="Sales Collection Status">
            <div className="h-[115px] p-3">
              {salesPaymentStatus.some((s) => s.value > 0) ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={salesPaymentStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={30} outerRadius={48} paddingAngle={2}>
                      {salesPaymentStatus.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                    </Pie>
                    <Tooltip formatter={(value) => formatCurrency(numberValue(value))} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-slate-400">No sales data</div>
              )}
            </div>
          </Panel>

          <Panel title="Purchase Payment Status">
            <div className="h-[115px] p-3">
              {purchasePaymentStatus.some((s) => s.value > 0) ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={purchasePaymentStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={30} outerRadius={48} paddingAngle={2}>
                      {purchasePaymentStatus.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                    </Pie>
                    <Tooltip formatter={(value) => formatCurrency(numberValue(value))} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-slate-400">No purchase data</div>
              )}
            </div>
          </Panel>
        </div>
      </div>

      {/* ── Trending Items (horizontal bar) + Total Expense ── */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Panel title="Top Selling Items" className="xl:col-span-2">
          <div className="divide-y divide-slate-50 dark:divide-slate-700">
            {trendingItems.length ? trendingItems.map((item, index) => {
              const max = Math.max(...trendingItems.map((t) => t.quantity), 1);
              const pct = Math.round((item.quantity / max) * 100);
              return (
                <div key={item.itemId} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="w-5 shrink-0 text-[11px] font-bold text-slate-400">#{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-slate-700 dark:text-slate-200">{item.itemName}</p>
                    <div className="mt-1 h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-700">
                      <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: TREND_COLORS[index % TREND_COLORS.length] }} />
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">{item.quantity.toLocaleString('en-IN')} units</p>
                    <p className="text-[10px] text-slate-400">{formatCurrency(item.totalAmount)}</p>
                  </div>
                </div>
              );
            }) : (
              <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                <PackageSearch size={32} />
                <p className="mt-2 text-xs">No sales data available</p>
              </div>
            )}
          </div>
        </Panel>

        <Panel title="Category Distribution">
          <div className="h-[260px] p-3">
            {trendingItems.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={trendingItems} dataKey="quantity" nameKey="itemName" cx="50%" cy="46%" innerRadius={52} outerRadius={80} paddingAngle={2}>
                    {trendingItems.map((item, index) => (
                      <Cell key={item.itemId} fill={TREND_COLORS[index % TREND_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => numberValue(value).toLocaleString('en-IN')} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-slate-400">
                <TrendingUp size={32} />
                <p className="mt-2 text-xs">No data</p>
              </div>
            )}
          </div>
        </Panel>
      </div>

      {/* ── Recent Invoices + Recent Purchases ── */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel title="Recent Sales Invoices" action={canViewSales ? <ViewAllButton onClick={() => navigate('/sales/invoices')} /> : undefined}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-xs">
              <thead className="bg-slate-50 text-left text-[10px] uppercase text-slate-500 dark:bg-[#1f2937]">
                <tr>
                  {['#', 'Date', 'Invoice', 'Customer', 'Total', 'Balance', 'Status'].map((h) => (
                    <th key={h} className="px-3 py-2.5 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentInvoices.length ? recentInvoices.map((inv, index) => (
                  <tr key={`${inv.saleId}-${inv.saleCode}`}
                    className="border-b border-slate-50 text-slate-700 last:border-0 dark:border-slate-700 dark:text-slate-300"
                  >
                    <td className="px-3 py-2.5">{index + 1}</td>
                    <td className="px-3 py-2.5">{formatDate(inv.invoiceDate)}</td>
                    <td className="px-3 py-2.5 font-medium">{inv.saleCode}</td>
                    <td className="px-3 py-2.5">{inv.customerName}</td>
                    <td className="px-3 py-2.5 font-semibold">{formatCurrency(inv.grandTotal)}</td>
                    <td className="px-3 py-2.5">{formatCurrency(inv.balance)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${inv.status.toUpperCase() === 'PAID' ? 'bg-green-100 text-green-600' : 'bg-amber-100 text-amber-700'}`}>
                        {inv.status}
                      </span>
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={7} className="py-8 text-center text-slate-400">No recent invoices</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Recent Purchases" action={canViewPurchases ? <ViewAllButton onClick={() => navigate('/purchase/bills')} /> : undefined}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-xs">
              <thead className="bg-slate-50 text-left text-[10px] uppercase text-slate-500 dark:bg-[#1f2937]">
                <tr>
                  {['#', 'Date', 'Supplier', 'Total', 'Due', 'Status'].map((h) => (
                    <th key={h} className="px-3 py-2.5 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentPurchases.length ? recentPurchases.map((p, index) => (
                  <tr key={p.purchaseId}
                    className="border-b border-slate-50 text-slate-700 last:border-0 dark:border-slate-700 dark:text-slate-300"
                  >
                    <td className="px-3 py-2.5">{index + 1}</td>
                    <td className="px-3 py-2.5">{formatDate(p.purchaseDate)}</td>
                    <td className="px-3 py-2.5 font-medium">{p.supplierName}</td>
                    <td className="px-3 py-2.5 font-semibold">{formatCurrency(p.grandTotal)}</td>
                    <td className="px-3 py-2.5 font-semibold text-rose-500">{formatCurrency(p.dueAmount)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${p.status.toUpperCase() === 'PAID' ? 'bg-green-100 text-green-600' : 'bg-amber-100 text-amber-700'}`}>
                        {p.status}
                      </span>
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={6} className="py-8 text-center text-slate-400">No recent purchases</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      {/* ── Low Stock Items ── */}
      <Panel title="Low Stock Alert" action={canViewLowStock ? <ViewAllButton onClick={() => navigate('/reports/low-stock')} /> : undefined}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-xs">
            <thead className="bg-slate-50 text-left text-[10px] uppercase text-slate-500 dark:bg-[#1f2937]">
              <tr>
                {['#', 'Item Name', 'Category', 'Brand', 'Min Stock', 'Current Stock', 'Unit', 'Status'].map((h) => (
                  <th key={h} className="px-3 py-2.5 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lowStockItems.length ? lowStockItems.map((item, index) => {
                const critical = numberValue(item.currentStock) === 0;
                return (
                  <tr key={`${item.itemId}-${index}`} className="border-b border-slate-50 text-slate-700 last:border-0 dark:border-slate-700 dark:text-slate-300">
                    <td className="px-3 py-2.5">{index + 1}</td>
                    <td className="px-3 py-2.5 font-medium">{item.itemName}</td>
                    <td className="px-3 py-2.5">{item.category || 'General'}</td>
                    <td className="px-3 py-2.5">{item.brand || '—'}</td>
                    <td className="px-3 py-2.5">{numberValue(item.minimumStock).toFixed(2)}</td>
                    <td className="px-3 py-2.5 font-semibold text-rose-500">{numberValue(item.currentStock).toFixed(2)}</td>
                    <td className="px-3 py-2.5">{item.unit || '—'}</td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${critical ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'}`}>
                        {critical ? 'Out of Stock' : 'Low'}
                      </span>
                    </td>
                  </tr>
                );
              }) : (
                <tr><td colSpan={8} className="py-8 text-center text-slate-400">All stock levels are healthy</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Scroll-to-top */}
      <button
        type="button"
        onClick={() => document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' })}
        className="fixed bottom-12 right-5 z-20 flex h-9 w-9 items-center justify-center rounded-lg bg-[#1684ed] text-white shadow-lg transition hover:bg-[#1270cc]"
        aria-label="Scroll to top"
      >
        <ArrowUp size={18} />
      </button>
    </div>
  );
};
