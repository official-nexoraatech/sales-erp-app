import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  ArrowUp,
  CheckCircle2,
  MinusCircle,
  PackageSearch,
  ShoppingCart,
  Tags,
  Users,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
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

interface MetricCardProps {
  title: string;
  value: number;
  color: string;
  icon: React.ReactNode;
  currency?: boolean;
}

const MetricCard: React.FC<MetricCardProps> = ({ title, value, color, icon, currency = false }) => (
  <div
    className="flex min-h-24 items-center justify-between rounded-lg border-l-[3px] bg-white px-4 py-3 shadow-[0_2px_10px_rgba(79,70,229,0.14)]"
    style={{ borderLeftColor: color }}
  >
    <div>
      <p className="max-w-32 text-xs leading-5 text-slate-500">{title}</p>
      <p className="mt-1 text-xl font-semibold" style={{ color }}>{metricValue(value, currency)}</p>
    </div>
    <div
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white shadow-sm"
      style={{ background: `linear-gradient(145deg, ${color}, ${color}cc)` }}
    >
      {icon}
    </div>
  </div>
);

const Panel: React.FC<React.PropsWithChildren<{ title: string; action?: React.ReactNode; className?: string }>> = ({
  title,
  action,
  className = '',
  children,
}) => (
  <section className={`overflow-hidden rounded-lg bg-white shadow-[0_2px_11px_rgba(79,70,229,0.14)] ${className}`}>
    <div className="flex min-h-11 items-center justify-between border-b border-slate-200 px-3.5 py-2">
      <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
      {action}
    </div>
    {children}
  </section>
);

const ViewAllButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="rounded border border-sky-400 px-2 py-1 text-[11px] font-medium text-sky-600 transition hover:bg-sky-50"
  >
    View All
  </button>
);

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const months = useMemo(lastSixMonths, []);
  const fromDate = `${months[0].key}-01`;
  const toDate = new Date().toISOString().slice(0, 10);

  const canViewDashboard = hasPermission(PERMISSIONS.DASHBOARD_VIEW);
  const canViewSales = hasPermission(PERMISSIONS.SALES_VIEW);
  const canViewPurchases = hasPermission(PERMISSIONS.PURCHASE_VIEW);
  const canViewExpenses = hasPermission(PERMISSIONS.EXPENSE_VIEW);
  const canViewLowStock = hasPermission(PERMISSIONS.REPORT_LOW_STOCK_VIEW);
  const canViewTopItems = hasPermission(PERMISSIONS.REPORT_TOP_SELLING_ITEMS_VIEW);

  const summaryQuery = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: dashboardApi.getSummary,
    enabled: canViewDashboard,
    retry: false,
  });
  const salesQuery = useQuery({
    queryKey: ['dashboard-sales', fromDate, toDate],
    queryFn: () => salesApi.getAll({ page: 0, size: 200, fromDate, toDate }),
    enabled: canViewSales,
    retry: false,
  });
  const purchasesQuery = useQuery({
    queryKey: ['dashboard-purchases', fromDate, toDate],
    queryFn: () => purchaseApi.getAll({ page: 0, size: 200, fromDate, toDate }),
    enabled: canViewPurchases,
    retry: false,
  });
  const expensesQuery = useQuery({
    queryKey: ['dashboard-expenses', fromDate, toDate],
    queryFn: () => expenseApi.getAll({ page: 0, size: 200, fromDate, toDate }),
    enabled: canViewExpenses,
    retry: false,
  });
  const lowStockQuery = useQuery({
    queryKey: ['dashboard-low-stock'],
    queryFn: reportsApi.lowStock,
    enabled: canViewLowStock,
    retry: false,
  });
  const topItemsQuery = useQuery({
    queryKey: ['dashboard-top-selling-items'],
    queryFn: reportsApi.topSellingItems,
    enabled: canViewTopItems,
    retry: false,
  });

  const summary = summaryQuery.data?.data;
  const sales = salesQuery.data?.data?.content || [];
  const purchases = purchasesQuery.data?.data?.content || [];
  const expenses = expensesQuery.data?.data?.content || [];

  const metrics = useMemo(() => {
    const pendingSales = sales.filter((sale) => !isCompleted(sale.status, sale.dueAmount)).length;
    const completedSales = sales.filter((sale) => isCompleted(sale.status, sale.dueAmount)).length;
    const pendingPurchases = purchases.filter((purchase) => !isCompleted(purchase.status, purchase.dueAmount)).length;
    const completedPurchases = purchases.filter((purchase) => isCompleted(purchase.status, purchase.dueAmount)).length;

    return {
      pendingSaleOrders: summary?.pendingSaleOrders ?? pendingSales,
      completedSaleOrders: summary?.completedSaleOrders ?? completedSales,
      paymentReceivables: summary?.paymentReceivables
        ?? sales.reduce((total, sale) => total + numberValue(sale.dueAmount), 0),
      paymentPayables: summary?.paymentPayables
        ?? purchases.reduce((total, purchase) => total + numberValue(purchase.dueAmount), 0),
      pendingPurchaseOrders: summary?.pendingPurchaseOrders ?? pendingPurchases,
      completedPurchaseOrders: summary?.completedPurchaseOrders ?? completedPurchases,
      totalExpense: summary?.totalExpense
        ?? summary?.todayExpense
        ?? expenses.reduce((total, expense) => total + numberValue(expense.amount), 0),
      totalCustomers: summary?.totalCustomers ?? 0,
    };
  }, [expenses, purchases, sales, summary]);

  const chartData = useMemo(() => {
    if (summary?.saleVsPurchase?.length) {
      return summary.saleVsPurchase.map((entry: DashboardTrendPoint) => ({
        month: entry.label || entry.month || entry.period || '',
        sales: numberValue(entry.sales ?? entry.saleAmount),
        purchases: numberValue(entry.purchases ?? entry.purchaseAmount),
      }));
    }

    const grouped = new Map(months.map((month) => [month.key, { month: month.label, sales: 0, purchases: 0 }]));
    sales.forEach((sale) => {
      const entry = grouped.get(monthKey(sale.invoiceDate));
      if (entry) entry.sales += numberValue(sale.grandTotal);
    });
    purchases.forEach((purchase) => {
      const entry = grouped.get(monthKey(purchase.purchaseDate));
      if (entry) entry.purchases += numberValue(purchase.grandTotal);
    });
    return [...grouped.values()];
  }, [months, purchases, sales, summary?.saleVsPurchase]);

  const trendingItems = useMemo<DashboardTrendingItem[]>(() => {
    if (summary?.trendingItems?.length) return summary.trendingItems.slice(0, 6);
    return (topItemsQuery.data?.data || []).slice(0, 6).map((item) => ({
      itemId: item.itemId,
      itemName: item.itemName,
      quantity: numberValue(item.quantity),
      totalAmount: numberValue(item.totalAmount),
    }));
  }, [summary?.trendingItems, topItemsQuery.data?.data]);

  const recentInvoices = useMemo<DashboardRecentInvoice[]>(() => {
    if (summary?.recentInvoices?.length) return summary.recentInvoices.slice(0, 7);
    return [...sales]
      .sort((left, right) => new Date(right.invoiceDate).getTime() - new Date(left.invoiceDate).getTime())
      .slice(0, 7)
      .map((sale: SaleListItem) => ({
        saleId: sale.saleId,
        invoiceDate: sale.invoiceDate,
        saleCode: sale.invoiceNo,
        customerName: sale.customerName,
        grandTotal: numberValue(sale.grandTotal),
        balance: numberValue(sale.dueAmount),
        status: isCompleted(sale.status, sale.dueAmount) ? 'PAID' : sale.status || 'DUE',
      }));
  }, [sales, summary?.recentInvoices]);

  const lowStockItems = useMemo<DashboardLowStockItem[]>(() => {
    if (summary?.lowStockDetails?.length) return summary.lowStockDetails.slice(0, 7);
    if (Array.isArray(summary?.lowStockItems)) return summary.lowStockItems.slice(0, 7);
    return (lowStockQuery.data?.data || []).slice(0, 7).map((item) => ({
      itemId: item.itemId,
      itemName: item.itemName,
      brand: item.brandName || '',
      category: item.categoryName || 'General',
      minimumStock: numberValue(item.reorderLevel),
      currentStock: numberValue(item.availableQty),
      unit: item.unitName || 'None',
    }));
  }, [lowStockQuery.data?.data, summary?.lowStockDetails, summary?.lowStockItems]);

  const hasAnyError = [
    summaryQuery,
    salesQuery,
    purchasesQuery,
    expensesQuery,
    lowStockQuery,
    topItemsQuery,
  ].some((query) => query.isError);

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
          Some dashboard sections could not be loaded. Available information is still shown below.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Pending Sale Orders" value={metrics.pendingSaleOrders} color="#18baf0" icon={<ShoppingCart size={23} />} />
        <MetricCard title="Completed Sale Orders" value={metrics.completedSaleOrders} color="#20bf55" icon={<CheckCircle2 size={23} />} />
        <MetricCard title="Payment Receivables" value={metrics.paymentReceivables} color="#ff3d5a" currency icon={<ArrowDownCircle size={23} />} />
        <MetricCard title="Payment Payables" value={metrics.paymentPayables} color="#ff9f0a" currency icon={<ArrowUpCircle size={23} />} />
        <MetricCard title="Pending Purchase Orders" value={metrics.pendingPurchaseOrders} color="#27aee9" icon={<Tags size={23} />} />
        <MetricCard title="Completed Purchase Orders" value={metrics.completedPurchaseOrders} color="#13b981" icon={<CheckCircle2 size={23} />} />
        <MetricCard title="Total Expense" value={metrics.totalExpense} color="#ff3d5a" currency icon={<MinusCircle size={23} />} />
        <MetricCard title="Total Customers" value={metrics.totalCustomers} color="#ff7a12" icon={<Users size={23} />} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[2fr_1fr]">
        <Panel title="Sale vs. Purchase">
          <div className="h-[300px] p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#e5e7eb" vertical />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} width={48} />
                <Tooltip formatter={(value) => formatCurrency(numberValue(value))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar name="Purchase Bills" dataKey="purchases" fill="#f5b800" radius={[6, 6, 0, 0]} maxBarSize={22} />
                <Bar name="Sale Invoices" dataKey="sales" fill="#24aee4" radius={[6, 6, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Trending Items">
          <div className="h-[300px] p-3">
            {trendingItems.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={trendingItems}
                    dataKey="quantity"
                    nameKey="itemName"
                    cx="50%"
                    cy="48%"
                    innerRadius={58}
                    outerRadius={88}
                    paddingAngle={1}
                  >
                    {trendingItems.map((item, index) => (
                      <Cell key={item.itemId} fill={TREND_COLORS[index % TREND_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => numberValue(value).toLocaleString('en-IN')} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-slate-400">
                <PackageSearch size={36} />
                <p className="mt-2 text-xs">No trending item data available</p>
              </div>
            )}
          </div>
        </Panel>
      </div>

      <Panel title="Recent Invoices" action={canViewSales ? <ViewAllButton onClick={() => navigate('/sales/invoices')} /> : undefined}>
        <div className="overflow-x-auto p-3">
          <table className="w-full min-w-[720px] text-xs">
            <thead className="bg-slate-50 text-left text-[11px] uppercase text-slate-700">
              <tr>
                {['Invoice Date', 'Sale Code', 'Customer Name', 'Grand Total', 'Balance', 'Status'].map((heading) => (
                  <th key={heading} className="px-2 py-2.5 font-semibold">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentInvoices.length ? recentInvoices.map((invoice) => (
                <tr
                  key={`${invoice.saleId}-${invoice.saleCode}`}
                  className="cursor-pointer border-b border-slate-100 text-slate-700 transition last:border-0 hover:bg-sky-50/50"
                  onClick={() => navigate(`/sales/invoices/${invoice.saleId}`)}
                >
                  <td className="px-2 py-2.5">{formatDate(invoice.invoiceDate)}</td>
                  <td className="px-2 py-2.5 font-medium">{invoice.saleCode}</td>
                  <td className="px-2 py-2.5">{invoice.customerName}</td>
                  <td className="px-2 py-2.5">{metricValue(invoice.grandTotal)}</td>
                  <td className="px-2 py-2.5">{metricValue(invoice.balance)}</td>
                  <td className="px-2 py-2.5">
                    <span className={`rounded-full px-3 py-1 text-[10px] font-semibold ${
                      invoice.status.toUpperCase() === 'PAID'
                        ? 'bg-green-100 text-green-600'
                        : 'bg-amber-100 text-amber-700'
                    }`}>
                      {invoice.status}
                    </span>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={6} className="py-8 text-center text-slate-400">No recent invoices available</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Low Stock Items" action={canViewLowStock ? <ViewAllButton onClick={() => navigate('/reports/low-stock')} /> : undefined}>
        <div className="overflow-x-auto p-3">
          <table className="w-full min-w-[760px] text-xs">
            <thead className="bg-slate-50 text-left text-[11px] uppercase text-slate-800">
              <tr>
                {['#', 'Item Name', 'Brand', 'Category', 'Minimum Stock', 'Current Stock', 'Unit'].map((heading) => (
                  <th key={heading} className="px-2 py-2.5 font-semibold">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lowStockItems.length ? lowStockItems.map((item, index) => (
                <tr key={`${item.itemId}-${index}`} className="border-b border-slate-100 text-slate-700 last:border-0">
                  <td className="px-2 py-2.5">{index + 1}</td>
                  <td className="px-2 py-2.5 font-medium">{item.itemName}</td>
                  <td className="px-2 py-2.5">{item.brand || 'N/A'}</td>
                  <td className="px-2 py-2.5">{item.category || 'General'}</td>
                  <td className="px-2 py-2.5">{numberValue(item.minimumStock).toFixed(2)}</td>
                  <td className="px-2 py-2.5 font-semibold text-rose-500">{numberValue(item.currentStock).toFixed(2)}</td>
                  <td className="px-2 py-2.5">{item.unit || 'None'}</td>
                </tr>
              )) : (
                <tr><td colSpan={7} className="py-8 text-center text-slate-400">No low stock items</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <button
        type="button"
        onClick={() => document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' })}
        className="fixed bottom-12 right-5 z-20 flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500 text-white shadow-lg transition hover:bg-sky-600"
        aria-label="Scroll to top"
      >
        <ArrowUp size={18} />
      </button>
    </div>
  );
};
