import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, TrendingUp, TrendingDown, Download } from 'lucide-react';
import { gstApi } from '../../api/endpoints.js';
import toast from 'react-hot-toast';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import MonthPicker from '../../components/ui/MonthPicker.js';
import Button from '../../components/ui/Button.js';

function getCurrentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function formatCurrency(val: unknown): string {
  const n = Number(val ?? 0);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(n);
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

  const entries =
    (registerData as { content?: Record<string, unknown>[] } | undefined)?.content ?? [];
  const summary = summaryData as Record<string, Record<string, unknown>> | undefined;

  const handleDownloadCsv = () => {
    if (!entries.length) {
      toast.error('No data to export');
      return;
    }
    const headers = [
      'Date',
      'Type',
      'Document No',
      'Counterparty',
      'GSTIN',
      'Taxable',
      'CGST',
      'SGST',
      'IGST',
      'Total GST',
    ];
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
          <BookOpen className="w-6 h-6 text-brand" />
          <div>
            <h1 className="text-xl font-semibold text-primary">GST Ledger Register</h1>
            <p className="text-sm text-secondary">Append-only GST entry log</p>
          </div>
        </div>
        <Button variant="outline" onClick={handleDownloadCsv}>
          <Download size={16} />
          Export CSV
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 items-end">
        <div>
          <MonthPicker label="Period" value={period} onChange={setPeriod} />
        </div>
        <div>
          <label className="block text-xs font-medium text-primary mb-1">Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
            className="px-3 py-2 text-sm bg-surface-card border border-default rounded-lg text-primary focus:outline-none focus:ring-2 focus:ring-focus"
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
            const color = key === 'sales' ? 'text-success' : 'text-danger';
            const labels: Record<string, string> = {
              sales: 'Sales',
              purchases: 'Purchases',
              creditNotes: 'Credit Notes',
              purchaseReturns: 'Purchase Returns',
            };
            return (
              <div key={key} className="bg-surface-card border border-default rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon className={`w-4 h-4 ${color}`} />
                  <span className="text-xs text-secondary">{labels[key]}</span>
                </div>
                <div className="text-lg font-semibold text-primary">
                  {formatCurrency(s?.totalGst)}
                </div>
                <div className="text-xs text-secondary mt-1">
                  Taxable: {formatCurrency(s?.taxableAmount)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Table */}
      <div className="bg-surface-card border border-default rounded-xl overflow-hidden">
        {regLoading ? (
          <ERPTableSkeleton rows={8} cols={11} />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-default">
              <thead className="bg-surface-subtle">
                <tr>
                  {[
                    'Date',
                    'Type',
                    'Document',
                    'Counterparty',
                    'GSTIN',
                    'Taxable',
                    'CGST',
                    'SGST',
                    'IGST',
                    'Total GST',
                    'ITC?',
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-default">
                {entries.length === 0 ? (
                  <tr>
                    <td colSpan={11}>
                      <ERPEmptyState
                        type="no-results"
                        title="No GST entries"
                        description={`No GST entries for ${period}.`}
                      />
                    </td>
                  </tr>
                ) : (
                  entries.map((row, i) => (
                    <tr key={i} className="hover:bg-surface-raised">
                      <td className="px-4 py-3 text-sm text-primary whitespace-nowrap">
                        {String(row.documentDate ?? '')}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            String(row.entryType).includes('SALES') ||
                            String(row.entryType) === 'CREDIT_NOTE'
                              ? 'bg-info-bg text-info'
                              : 'bg-accent-purple-subtle text-accent-purple'
                          }`}
                        >
                          {String(row.entryType ?? '').replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-primary font-mono">
                        {String(row.documentNumber ?? '')}
                      </td>
                      <td className="px-4 py-3 text-sm text-primary">
                        {String(row.counterpartyName ?? '-')}
                      </td>
                      <td className="px-4 py-3 text-sm text-secondary font-mono">
                        {String(row.gstinOfCounterparty ?? '-')}
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-primary">
                        {formatCurrency(row.taxableAmount)}
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-primary">
                        {formatCurrency(row.cgstAmount)}
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-primary">
                        {formatCurrency(row.sgstAmount)}
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-primary">
                        {formatCurrency(row.igstAmount)}
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-medium text-primary">
                        {formatCurrency(row.totalGst)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {row.itcEligible ? (
                          <span className="text-xs font-medium text-success">Yes</span>
                        ) : (
                          <span className="text-xs text-disabled">No</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
        {entries.length > 0 && (
          <div className="px-4 py-3 border-t border-default text-xs text-secondary">
            {entries.length} entries
          </div>
        )}
      </div>
    </div>
  );
}
