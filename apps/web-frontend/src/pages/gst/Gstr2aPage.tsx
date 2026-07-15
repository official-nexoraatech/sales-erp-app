import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCcw, Upload, CheckCircle, AlertTriangle, XCircle, Info } from 'lucide-react';
import { gstApi } from '../../api/endpoints.js';
import toast from 'react-hot-toast';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import ERPTabs from '../../components/erp/ERPTabs.js';
import MonthPicker from '../../components/ui/MonthPicker.js';
import Button from '../../components/ui/Button.js';

function getCurrentPeriod(): string {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
}

function formatCurrency(val: unknown): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(Number(val ?? 0));
}

type ReconcStatus = 'MATCHED' | 'BOOKS_ONLY' | 'GSTR2A_ONLY' | 'AMOUNT_MISMATCH' | 'UNMATCHED';

const STATUS_CONFIG: Record<
  ReconcStatus,
  { label: string; color: string; icon: React.ReactNode; action: string }
> = {
  MATCHED: {
    label: 'Matched',
    color: 'text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30',
    icon: <CheckCircle className="w-3.5 h-3.5" />,
    action: 'No action needed',
  },
  BOOKS_ONLY: {
    label: 'Books Only',
    color: 'text-blue-700 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30',
    icon: <Info className="w-3.5 h-3.5" />,
    action: 'Contact supplier to file GSTR-1',
  },
  GSTR2A_ONLY: {
    label: 'GSTR-2A Only',
    color: 'text-purple-700 dark:text-purple-400 bg-purple-100 dark:bg-purple-900/30',
    icon: <Info className="w-3.5 h-3.5" />,
    action: 'Check if GRN was missed',
  },
  AMOUNT_MISMATCH: {
    label: 'Amount Mismatch',
    color: 'text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30',
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
    action: 'Raise debit note or amend GRN',
  },
  UNMATCHED: {
    label: 'Unmatched',
    color: 'text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-900/30',
    icon: <XCircle className="w-3.5 h-3.5" />,
    action: 'Manual review required',
  },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status as ReconcStatus] ?? STATUS_CONFIG.UNMATCHED;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}
    >
      {cfg.icon} {cfg.label}
    </span>
  );
}

export function Gstr2aPage() {
  const [period, setPeriod] = useState(getCurrentPeriod());
  const [activeTab, setActiveTab] = useState<'gstr2a' | 'books'>('gstr2a');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const { data: reconcData, isLoading } = useQuery({
    queryKey: ['gstr2a-reconciliation', period],
    queryFn: () => gstApi.gstr2aReconciliation(period),
  });

  const importMutation = useMutation({
    mutationFn: (entries: unknown[]) => gstApi.importGstr2a(period, entries),
    onSuccess: (res) => {
      const d = res as Record<string, unknown>;
      toast.success(
        `Imported ${String(d.imported ?? 0)} entries, ${String(d.skippedDuplicates ?? 0)} duplicates skipped`
      );
      void qc.invalidateQueries({ queryKey: ['gstr2a-reconciliation', period] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target?.result as string);
        const entries = Array.isArray(json) ? json : (json.data ?? json.entries ?? []);
        importMutation.mutate(entries as unknown[]);
      } catch {
        toast.error('Invalid JSON file');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const summary = reconcData?.summary as Record<string, unknown> | undefined;
  const gstr2aEntries = (reconcData?.gstr2aEntries as unknown[]) ?? [];
  const booksOnlyEntries = (reconcData?.booksOnlyEntries as unknown[]) ?? [];

  const summaryCards = [
    { key: 'matched', label: 'Matched', color: 'text-green-600 dark:text-green-400' },
    { key: 'amountMismatch', label: 'Mismatch', color: 'text-amber-600 dark:text-amber-400' },
    { key: 'booksOnly', label: 'Books Only', color: 'text-blue-600 dark:text-blue-400' },
    { key: 'gstr2aOnly', label: '2A Only', color: 'text-purple-600 dark:text-purple-400' },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <RefreshCcw className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
              GSTR-2A Reconciliation
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Match purchase books against supplier-filed GSTR-2A data
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileUpload}
            className="hidden"
          />
          <Button
            variant="secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={importMutation.isPending}
          >
            <Upload size={16} />
            Import 2A (JSON)
          </Button>
        </div>
      </div>

      <div>
        <MonthPicker label="Period" value={period} onChange={setPeriod} />
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {summaryCards.map(({ key, label, color }) => (
            <div
              key={key}
              className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 text-center"
            >
              <div className={`text-2xl font-bold ${color}`}>{String(summary[key] ?? 0)}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tolerance note */}
      <div className="flex items-start gap-2 text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/50 rounded-lg px-4 py-3">
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-gray-400 dark:text-gray-500" />
        <span>
          Match tolerance: ±1% on GST amounts. Entries within tolerance are marked MATCHED
          automatically.
        </span>
      </div>

      {/* Tabs */}
      <ERPTabs
        tabs={[
          { key: 'gstr2a', label: `GSTR-2A Entries (${gstr2aEntries.length})` },
          { key: 'books', label: `Books Only (${booksOnlyEntries.length})` },
        ]}
        active={activeTab}
        onChange={(key) => setActiveTab(key as typeof activeTab)}
      />

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        {isLoading ? (
          <ERPTableSkeleton rows={6} cols={7} />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900/50">
                <tr>
                  {[
                    'Supplier GSTIN',
                    'Invoice No',
                    'Date',
                    'Taxable',
                    'GST Total',
                    'Status',
                    'Variance',
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {activeTab === 'gstr2a' ? (
                  gstr2aEntries.length === 0 ? (
                    <tr>
                      <td colSpan={7}>
                        <ERPEmptyState
                          type="no-data"
                          title="No GSTR-2A entries imported"
                          description={`Upload a JSON file from the GST portal to start reconciliation for ${period}.`}
                          action={{
                            label: 'Import 2A (JSON)',
                            onClick: () => fileInputRef.current?.click(),
                          }}
                        />
                      </td>
                    </tr>
                  ) : (
                    gstr2aEntries.map((e, i) => {
                      const r = e as Record<string, unknown>;
                      const totalGst =
                        Number(r.cgstAmount ?? 0) +
                        Number(r.sgstAmount ?? 0) +
                        Number(r.igstAmount ?? 0);
                      return (
                        <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                          <td className="px-4 py-3 text-xs font-mono text-gray-700 dark:text-gray-300">
                            {String(r.supplierGstin ?? '')}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                            {String(r.invoiceNumber ?? '')}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
                            {String(r.invoiceDate ?? '')}
                          </td>
                          <td className="px-4 py-3 text-sm text-right text-gray-700 dark:text-gray-300">
                            {formatCurrency(r.taxableAmount)}
                          </td>
                          <td className="px-4 py-3 text-sm text-right text-gray-700 dark:text-gray-300">
                            {formatCurrency(totalGst)}
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge status={String(r.reconciliationStatus ?? 'UNMATCHED')} />
                          </td>
                          <td className="px-4 py-3 text-sm text-right">
                            {r.matchVariance != null ? (
                              <span
                                className={
                                  Number(r.matchVariance) > 0
                                    ? 'text-red-600 dark:text-red-400'
                                    : 'text-green-600 dark:text-green-400'
                                }
                              >
                                {formatCurrency(r.matchVariance)}
                              </span>
                            ) : (
                              <span className="text-gray-400 dark:text-gray-500">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )
                ) : booksOnlyEntries.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-sm text-secondary">
                      <CheckCircle className="w-8 h-8 text-green-400 dark:text-green-500 mx-auto mb-2" />
                      All purchase entries are matched
                    </td>
                  </tr>
                ) : (
                  booksOnlyEntries.map((e, i) => {
                    const r = e as Record<string, unknown>;
                    const totalGst =
                      Number(r.cgstAmount ?? 0) +
                      Number(r.sgstAmount ?? 0) +
                      Number(r.igstAmount ?? 0);
                    return (
                      <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="px-4 py-3 text-xs font-mono text-gray-700 dark:text-gray-300">
                          {String(r.gstinOfCounterparty ?? '—')}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                          {String(r.documentNumber ?? '')}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                          {String(r.documentDate ?? '')}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-700 dark:text-gray-300">
                          {formatCurrency(r.taxableAmount)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-700 dark:text-gray-300">
                          {formatCurrency(totalGst)}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status="BOOKS_ONLY" />
                        </td>
                        <td className="px-4 py-3 text-sm text-disabled text-center">—</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
