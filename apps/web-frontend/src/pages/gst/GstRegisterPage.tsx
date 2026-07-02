import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, TrendingUp, TrendingDown, AlertCircle, Download } from 'lucide-react';
import { gstApi } from '../../api/endpoints.js';
import toast from 'react-hot-toast';

function getCurrentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function formatCurrency(val: unknown): string {
  const n = Number(val ?? 0);
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n);
}

export function GstRegisterPage() {
  const [period, setPeriod] = useState(getCurrentPeriod());
  const [type, setType] = useState<'SALES' | 'PURCHASE' | 'ALL'>('ALL');

  const { data: registerData, isLoading: regLoading } = useQuery({
    queryKey: ['gst-register', period, type],
    queryFn: () => gstApi.register(period, type),
  });

  const { data: summaryData, isLoading: sumLoading } = useQuery({
    queryKey: ['gst-summary', period],
    queryFn: () => gstApi.summary(period),
  });

  const entries = ((registerData as { content?: Record<string, unknown>[] } | undefined)?.content) ?? [];
  const summary = summaryData as Record<string, Record<string, unknown>> | undefined;

  const handleDownloadCsv = () => {
    if (!entries.length) { toast.error('No data to export'); return; }
    const headers = ['Date', 'Type', 'Document No', 'Counterparty', 'GSTIN', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total GST'];
    const rows = entries.map((e) => [
      String(e.documentDate ?? ''),
      String(e.entryType ?? ''),
      String(e.documentNumber ?? ''),
      String(e.counterpartyName ?? ''),
      String(e.gstinOfCounterparty ?? ''),
      String(e.taxableAmount ?? '0'),
      String(e.cgstAmount ?? '0'),
      String(e.sgstAmount ?? '0'),
      String(e.igstAmount ?? '0'),
      String(e.totalGst ?? '0'),
    ]);
    const csv = [headers, ...rows].map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gst-register-${period}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BookOpen className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white">GST Ledger Register</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Append-only GST entry log</p>
          </div>
        </div>
        <button
          onClick={handleDownloadCsv}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <Download className="w-4 h-4" />
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-4 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Period</label>
          <input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
            className="px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="ALL">All Entries</option>
            <option value="SALES">Sales Only</option>
            <option value="PURCHASE">Purchase Only</option>
          </select>
        </div>
      </div>

      {/* Summary cards */}
      {!sumLoading && summary && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {(['sales', 'purchases', 'creditNotes', 'purchaseReturns'] as const).map((key) => {
            const s = summary[key] as Record<string, unknown> | undefined;
            const isSales = key === 'sales' || key === 'purchases';
            const Icon = isSales ? TrendingUp : TrendingDown;
            const color = key === 'sales' ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400';
            const labels: Record<string, string> = { sales: 'Sales', purchases: 'Purchases', creditNotes: 'Credit Notes', purchaseReturns: 'Purchase Returns' };
            return (
              <div key={key} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon className={`w-4 h-4 ${color}`} />
                  <span className="text-xs text-gray-500 dark:text-gray-400">{labels[key]}</span>
                </div>
                <div className="text-lg font-semibold text-gray-900 dark:text-white">
                  {formatCurrency(s?.totalGst)}
                </div>
                <div className="text-xs text-gray-400 mt-1">Taxable: {formatCurrency(s?.taxableAmount)}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900/50">
              <tr>
                {['Date', 'Type', 'Document', 'Counterparty', 'GSTIN', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total GST', 'ITC?'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {regLoading ? (
                <tr><td colSpan={11} className="px-4 py-8 text-center text-sm text-gray-400">Loading...</td></tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center">
                    <AlertCircle className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                    <span className="text-sm text-gray-400">No GST entries for {period}</span>
                  </td>
                </tr>
              ) : entries.map((row, i) => (
                <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">{String(row.documentDate ?? '')}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                      String(row.entryType).includes('SALES') || String(row.entryType) === 'CREDIT_NOTE'
                        ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                        : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400'
                    }`}>
                      {String(row.entryType ?? '').replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 font-mono">{String(row.documentNumber ?? '')}</td>
                  <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">{String(row.counterpartyName ?? '-')}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 font-mono">{String(row.gstinOfCounterparty ?? '-')}</td>
                  <td className="px-4 py-3 text-sm text-right text-gray-700 dark:text-gray-300">{formatCurrency(row.taxableAmount)}</td>
                  <td className="px-4 py-3 text-sm text-right text-gray-700 dark:text-gray-300">{formatCurrency(row.cgstAmount)}</td>
                  <td className="px-4 py-3 text-sm text-right text-gray-700 dark:text-gray-300">{formatCurrency(row.sgstAmount)}</td>
                  <td className="px-4 py-3 text-sm text-right text-gray-700 dark:text-gray-300">{formatCurrency(row.igstAmount)}</td>
                  <td className="px-4 py-3 text-sm text-right font-medium text-gray-900 dark:text-white">{formatCurrency(row.totalGst)}</td>
                  <td className="px-4 py-3 text-center">
                    {row.itcEligible
                      ? <span className="text-xs font-medium text-green-600 dark:text-green-400">Yes</span>
                      : <span className="text-xs text-gray-400">No</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {entries.length > 0 && (
          <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
            {entries.length} entries
          </div>
        )}
      </div>
    </div>
  );
}
