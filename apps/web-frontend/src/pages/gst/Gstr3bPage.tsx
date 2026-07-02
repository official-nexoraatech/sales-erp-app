import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Calculator, Download, Info, ChevronDown, ChevronRight } from 'lucide-react';
import { gstApi } from '../../api/endpoints.js';
import toast from 'react-hot-toast';

function getCurrentPeriod(): string {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
}

function formatCurrency(val: unknown): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(val ?? 0));
}

interface TableRowProps {
  label: string;
  igst?: unknown;
  cgst?: unknown;
  sgst?: unknown;
  cess?: unknown;
  total?: unknown;
  bold?: boolean;
  indent?: boolean;
}

function TableRow({ label, igst, cgst, sgst, cess, total, bold, indent }: TableRowProps) {
  return (
    <tr className={`${bold ? 'bg-gray-50 dark:bg-gray-900/30 font-semibold' : ''} border-b border-gray-100 dark:border-gray-700`}>
      <td className={`py-3 pr-4 text-sm text-gray-700 dark:text-gray-300 ${indent ? 'pl-8' : 'pl-4'}`}>{label}</td>
      {[igst, cgst, sgst, cess, total].map((v, i) => (
        <td key={i} className="py-3 px-4 text-sm text-right text-gray-700 dark:text-gray-300 whitespace-nowrap">
          {v !== undefined ? formatCurrency(v) : '—'}
        </td>
      ))}
    </tr>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl">
      <button
        className="w-full flex items-center justify-between px-5 py-4 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="text-sm font-semibold text-gray-900 dark:text-white">{title}</span>
        {open ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
      </button>
      {open && <div className="border-t border-gray-100 dark:border-gray-700">{children}</div>}
    </div>
  );
}

export function Gstr3bPage() {
  const [period, setPeriod] = useState(getCurrentPeriod());

  const { data: result, isLoading } = useQuery({
    queryKey: ['gstr3b', period],
    queryFn: () => gstApi.gstr3b(period),
    select: (r) => r as Record<string, unknown>,
  });

  const exportMutation = useMutation({
    mutationFn: () => gstApi.exportGstr3b(period),
    onSuccess: (res) => {
      const json = JSON.stringify(res, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `GSTR3B_${period}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('GSTR-3B exported');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const table31 = result?.table31 as Record<string, unknown> | undefined;
  const table4 = result?.table4 as Record<string, unknown> | undefined;
  const itcSetoff = result?.itcSetoff as Record<string, unknown> | undefined;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Calculator className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white">GSTR-3B</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Monthly Summary Return</p>
          </div>
        </div>
        <button
          onClick={() => exportMutation.mutate()}
          disabled={exportMutation.isPending || !result}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          <Download className="w-4 h-4" />
          Export JSON
        </button>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Period</label>
        <input
          type="month"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-gray-400">Computing GSTR-3B...</div>
      ) : !result ? (
        <div className="py-12 text-center text-sm text-gray-400">No data for selected period</div>
      ) : (
        <div className="space-y-4">
          {/* Table 3.1 */}
          <Section title="3.1 — Outward Taxable Supplies (net of credit notes)">
            <table className="min-w-full">
              <thead><tr className="bg-gray-50 dark:bg-gray-900/30">
                <th className="py-3 pl-4 pr-4 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Nature of supply</th>
                <th className="py-3 px-4 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">IGST</th>
                <th className="py-3 px-4 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">CGST</th>
                <th className="py-3 px-4 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">SGST</th>
                <th className="py-3 px-4 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Cess</th>
                <th className="py-3 px-4 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Total Tax</th>
              </tr></thead>
              <tbody>
                <TableRow label="(a) Outward taxable supplies (other than zero rated, nil and exempted)" igst={(table31 as Record<string, unknown> | undefined)?.a_igst} cgst={(table31 as Record<string, unknown> | undefined)?.a_cgst} sgst={(table31 as Record<string, unknown> | undefined)?.a_sgst} cess={(table31 as Record<string, unknown> | undefined)?.a_cess} />
                <TableRow label="(d) Inward supplies (reverse charge)" igst={(table31 as Record<string, unknown> | undefined)?.d_igst} cgst={(table31 as Record<string, unknown> | undefined)?.d_cgst} sgst={(table31 as Record<string, unknown> | undefined)?.d_sgst} />
                <TableRow label="Total outward liability" igst={(table31 as Record<string, unknown> | undefined)?.total_igst} cgst={(table31 as Record<string, unknown> | undefined)?.total_cgst} sgst={(table31 as Record<string, unknown> | undefined)?.total_sgst} cess={(table31 as Record<string, unknown> | undefined)?.total_cess} bold />
              </tbody>
            </table>
          </Section>

          {/* Table 4 */}
          <Section title="4 — Eligible ITC">
            <table className="min-w-full">
              <thead><tr className="bg-gray-50 dark:bg-gray-900/30">
                <th className="py-3 pl-4 pr-4 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Details</th>
                <th className="py-3 px-4 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">IGST</th>
                <th className="py-3 px-4 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">CGST</th>
                <th className="py-3 px-4 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">SGST</th>
                <th className="py-3 px-4 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Cess</th>
                <th className="py-3 px-4 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Total</th>
              </tr></thead>
              <tbody>
                <TableRow label="(A) ITC Available — Imports & others" igst={(table4 as Record<string, unknown> | undefined)?.a_igst} cgst={(table4 as Record<string, unknown> | undefined)?.a_cgst} sgst={(table4 as Record<string, unknown> | undefined)?.a_sgst} cess={(table4 as Record<string, unknown> | undefined)?.a_cess} />
                <TableRow label="(D) Reversals of ITC" igst={(table4 as Record<string, unknown> | undefined)?.d_igst} cgst={(table4 as Record<string, unknown> | undefined)?.d_cgst} sgst={(table4 as Record<string, unknown> | undefined)?.d_sgst} />
                <TableRow label="Net ITC Available" igst={(table4 as Record<string, unknown> | undefined)?.net_igst} cgst={(table4 as Record<string, unknown> | undefined)?.net_cgst} sgst={(table4 as Record<string, unknown> | undefined)?.net_sgst} cess={(table4 as Record<string, unknown> | undefined)?.net_cess} bold />
              </tbody>
            </table>
          </Section>

          {/* ITC Set-off summary */}
          {itcSetoff && (
            <Section title="ITC Set-off Computation (per GST Act S.49)">
              <div className="px-5 py-4">
                <div className="flex items-start gap-2 mb-4 text-xs text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg px-3 py-2">
                  <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>Set-off order: IGST liability → IGST ITC → CGST ITC → SGST ITC. CGST liability uses IGST then CGST only (never SGST). SGST liability uses IGST then SGST only (never CGST).</span>
                </div>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  {(['igst', 'cgst', 'sgst'] as const).map((t) => {
                    const so = (itcSetoff.setoffBreakdown as Record<string, unknown> | undefined)?.[t] as Record<string, unknown> | undefined;
                    const cash = (itcSetoff.cashRequired as Record<string, unknown> | undefined)?.[t];
                    return (
                      <div key={t} className="bg-gray-50 dark:bg-gray-900/30 rounded-lg p-4">
                        <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-3">{t.toUpperCase()} Liability</div>
                        {so && Object.entries(so).map(([k, v]) => (
                          <div key={k} className="flex justify-between text-xs text-gray-600 dark:text-gray-400 mb-1">
                            <span>{k.replace(/_/g, ' ')}</span>
                            <span>{formatCurrency(v)}</span>
                          </div>
                        ))}
                        {cash !== undefined && Number(cash) > 0 && (
                          <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 flex justify-between text-xs font-semibold text-red-600 dark:text-red-400">
                            <span>Cash required</span>
                            <span>{formatCurrency(cash)}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 flex justify-between items-center px-4 py-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg border border-orange-200 dark:border-orange-800">
                  <span className="text-sm font-medium text-orange-800 dark:text-orange-300">Total Cash Required (GST payable)</span>
                  <span className="text-lg font-bold text-orange-700 dark:text-orange-400">
                    {formatCurrency(
                      Number((itcSetoff.cashRequired as Record<string, unknown> | undefined)?.igst ?? 0) +
                      Number((itcSetoff.cashRequired as Record<string, unknown> | undefined)?.cgst ?? 0) +
                      Number((itcSetoff.cashRequired as Record<string, unknown> | undefined)?.sgst ?? 0)
                    )}
                  </span>
                </div>
              </div>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}
