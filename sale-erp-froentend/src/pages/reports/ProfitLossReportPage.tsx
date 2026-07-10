import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../../api/endpoints';
import { Button } from '../../components/ui/Button';
import { Loader } from '../../components/ui/Loader';

const inputClass = 'h-10 w-full rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50';

const formatDateForApi = (value: string) => value;

const toIsoDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const today = new Date();
const defaultFromDate = toIsoDate(new Date(today.getFullYear(), today.getMonth(), 1));
const defaultToDate = toIsoDate(today);

const numberValue = (data: any, keys: string[], fallback = 0) => {
  for (const key of keys) {
    const value = Number(data?.[key]);
    if (!Number.isNaN(value)) return value;
  }
  return fallback;
};

const amount = (value: number) => value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const ProfitLossReportPage: React.FC = () => {
  const [filters, setFilters] = useState({ fromDate: defaultFromDate, toDate: defaultToDate, warehouse: '' });
  const [submitted, setSubmitted] = useState<typeof filters | null>(null);
  const report = useQuery({
    queryKey: ['report', 'profit-loss', submitted],
    queryFn: () => reportsApi.profitLoss({ fromDate: formatDateForApi(submitted?.fromDate || ''), toDate: formatDateForApi(submitted?.toDate || '') }),
    enabled: Boolean(submitted),
  });
  const data = report.data?.data || {};
  const rows = useMemo(() => {
    const saleWithoutTax = numberValue(data, ['saleWithoutTax', 'salesWithoutTax', 'sales']);
    const saleReturnWithoutTax = numberValue(data, ['saleReturnWithoutTax', 'salesReturnWithoutTax', 'saleReturns']);
    const purchaseWithoutTax = numberValue(data, ['purchaseWithoutTax', 'purchasesWithoutTax', 'purchases']);
    const purchaseReturnWithoutTax = numberValue(data, ['purchaseReturnWithoutTax', 'purchaseReturns']);
    const expenseWithoutTax = numberValue(data, ['expenseWithoutTax', 'expenses']);
    const shippingCharge = numberValue(data, ['shippingCharge', 'shipping']);
    const netSummary = numberValue(data, ['netSummary', 'netProfit', 'profitLoss'], saleWithoutTax - saleReturnWithoutTax - purchaseWithoutTax + purchaseReturnWithoutTax - expenseWithoutTax - shippingCharge);
    return [
      ['Sale Without Tax (+)', saleWithoutTax],
      ['Sale Return Without Tax (-)', saleReturnWithoutTax],
      ['Purchase Without Tax (-)', purchaseWithoutTax],
      ['Purchase Return Without Tax (+)', purchaseReturnWithoutTax],
      ['Expense without Tax (-)', expenseWithoutTax],
      ['Shipping Charge (-)', shippingCharge],
      ['Net Summary', netSummary],
    ];
  }, [data]);
  const grossProfit = numberValue(data, ['grossProfit'], Number(rows[0][1]) - Number(rows[2][1]));

  return (
    <div className="space-y-6">
      <div className="text-sm text-gray-500">Home &gt; Reports &gt; Profit and Loss</div>
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="border-b px-5 py-4">
          <h1 className="text-xl font-semibold text-gray-900">Filter</h1>
        </div>
        <div className="grid grid-cols-1 gap-5 p-5 md:grid-cols-2">
          <label className="text-sm text-gray-600">From Date<input className={`${inputClass} mt-1`} type="date" value={filters.fromDate} onChange={(event) => setFilters((current) => ({ ...current, fromDate: event.target.value }))} /></label>
          <label className="text-sm text-gray-600">To Date<input className={`${inputClass} mt-1`} type="date" value={filters.toDate} onChange={(event) => setFilters((current) => ({ ...current, toDate: event.target.value }))} /></label>
          <label className="text-sm text-gray-600">Warehouse<select className={`${inputClass} mt-1`} value={filters.warehouse} onChange={(event) => setFilters((current) => ({ ...current, warehouse: event.target.value }))}><option value="">Select Warehouse</option></select></label>
        </div>
        <div className="flex gap-3 px-5 pb-5">
          <Button type="button" onClick={() => setSubmitted({ ...filters })}>Submit</Button>
          <Button type="button" variant="secondary" onClick={() => setSubmitted(null)}>Close</Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="border-b px-5 py-4">
          <h2 className="text-xl font-semibold text-gray-900">Balance Sheet Report</h2>
        </div>
        {report.isLoading ? (
          <div className="p-10"><Loader /></div>
        ) : (
          <div className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-[1fr_1fr]">
            <table className="w-full text-sm">
              <thead><tr><th className="border p-3 text-left">Transaction Type</th><th className="border p-3 text-right">Total Amount</th></tr></thead>
              <tbody>
                {rows.map(([label, value]) => (
                  <tr key={label as string} className="even:bg-gray-50">
                    <td className="border p-3 font-medium">{label}</td>
                    <td className="border p-3 text-right font-semibold">{amount(value as number)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="h-fit w-full text-sm">
              <thead><tr><th className="border p-3 text-left">Transaction Type</th><th className="border p-3 text-right">Total Amount</th></tr></thead>
              <tbody>
                <tr>
                  <td className="border p-3">
                    <div className="font-medium">Gross Profit</div>
                    <div className="text-xs italic text-gray-600">(Sale Price - Average Purchase Price)</div>
                    <div className="text-xs italic text-gray-600">Sale Price = Sale Total - Discount Amount - Tax Amount</div>
                  </td>
                  <td className="border p-3 text-right font-semibold">{amount(grossProfit)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
