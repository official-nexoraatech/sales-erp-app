import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Calculator, Download, Info, ChevronDown, ChevronRight } from 'lucide-react';
import { gstApi } from '../../api/endpoints.js';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import { ERPCardSkeleton } from '../../components/erp/ERPSkeleton.js';
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
    <tr className={`${bold ? 'bg-surface-subtle font-semibold' : ''} border-b border-default`}>
      <td className={`py-3 pr-4 text-sm text-primary ${indent ? 'pl-8' : 'pl-4'}`}>{label}</td>
      {[igst, cgst, sgst, cess, total].map((v, i) => (
        <td key={i} className="py-3 px-4 text-sm text-right text-primary whitespace-nowrap">
          {v !== undefined ? formatCurrency(v) : '—'}
        </td>
      ))}
    </tr>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="bg-surface-card border border-default rounded-xl">
      <button
        className="w-full flex items-center justify-between px-5 py-4 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="text-sm font-semibold text-primary">{title}</span>
        {open ? (
          <ChevronDown className="w-4 h-4 text-secondary" />
        ) : (
          <ChevronRight className="w-4 h-4 text-secondary" />
        )}
      </button>
      {open && <div className="border-t border-default">{children}</div>}
    </div>
  );
}

export function Gstr3bPage() {
  const canFileGstr3b = useAuthStore((s) => s.hasPermission(PERMISSIONS.GSTR3B_FILE));
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
          <Calculator className="w-6 h-6 text-brand" />
          <div>
            <h1 className="text-xl font-semibold text-primary">GSTR-3B</h1>
            <p className="text-sm text-secondary">Monthly Summary Return</p>
          </div>
        </div>
        {canFileGstr3b && (
          <Button
            variant="primary"
            onClick={() => exportMutation.mutate()}
            disabled={exportMutation.isPending || !result}
          >
            <Download size={16} />
            Export JSON
          </Button>
        )}
      </div>

      <div>
        <MonthPicker label="Period" value={period} onChange={setPeriod} />
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <ERPCardSkeleton lines={3} />
          <ERPCardSkeleton lines={3} />
        </div>
      ) : !result ? (
        <div className="py-12 text-center text-sm text-secondary">No data for selected period</div>
      ) : (
        <div className="space-y-4">
          {/* Table 3.1 */}
          <Section title="3.1 — Outward Taxable Supplies (net of credit notes)">
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="bg-surface-subtle">
                    <th className="py-3 pl-4 pr-4 text-left text-xs font-medium text-secondary uppercase">
                      Nature of supply
                    </th>
                    <th className="py-3 px-4 text-right text-xs font-medium text-secondary uppercase">
                      IGST
                    </th>
                    <th className="py-3 px-4 text-right text-xs font-medium text-secondary uppercase">
                      CGST
                    </th>
                    <th className="py-3 px-4 text-right text-xs font-medium text-secondary uppercase">
                      SGST
                    </th>
                    <th className="py-3 px-4 text-right text-xs font-medium text-secondary uppercase">
                      Cess
                    </th>
                    <th className="py-3 px-4 text-right text-xs font-medium text-secondary uppercase">
                      Total Tax
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <TableRow
                    label="(a) Outward taxable supplies (other than zero rated, nil and exempted)"
                    igst={(table31 as Record<string, unknown> | undefined)?.a_igst}
                    cgst={(table31 as Record<string, unknown> | undefined)?.a_cgst}
                    sgst={(table31 as Record<string, unknown> | undefined)?.a_sgst}
                    cess={(table31 as Record<string, unknown> | undefined)?.a_cess}
                  />
                  <TableRow
                    label="(d) Inward supplies (reverse charge)"
                    igst={(table31 as Record<string, unknown> | undefined)?.d_igst}
                    cgst={(table31 as Record<string, unknown> | undefined)?.d_cgst}
                    sgst={(table31 as Record<string, unknown> | undefined)?.d_sgst}
                  />
                  <TableRow
                    label="Total outward liability"
                    igst={(table31 as Record<string, unknown> | undefined)?.total_igst}
                    cgst={(table31 as Record<string, unknown> | undefined)?.total_cgst}
                    sgst={(table31 as Record<string, unknown> | undefined)?.total_sgst}
                    cess={(table31 as Record<string, unknown> | undefined)?.total_cess}
                    bold
                  />
                </tbody>
              </table>
            </div>
          </Section>

          {/* Table 4 */}
          <Section title="4 — Eligible ITC">
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="bg-surface-subtle">
                    <th className="py-3 pl-4 pr-4 text-left text-xs font-medium text-secondary uppercase">
                      Details
                    </th>
                    <th className="py-3 px-4 text-right text-xs font-medium text-secondary uppercase">
                      IGST
                    </th>
                    <th className="py-3 px-4 text-right text-xs font-medium text-secondary uppercase">
                      CGST
                    </th>
                    <th className="py-3 px-4 text-right text-xs font-medium text-secondary uppercase">
                      SGST
                    </th>
                    <th className="py-3 px-4 text-right text-xs font-medium text-secondary uppercase">
                      Cess
                    </th>
                    <th className="py-3 px-4 text-right text-xs font-medium text-secondary uppercase">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <TableRow
                    label="(A) ITC Available — Imports & others"
                    igst={(table4 as Record<string, unknown> | undefined)?.a_igst}
                    cgst={(table4 as Record<string, unknown> | undefined)?.a_cgst}
                    sgst={(table4 as Record<string, unknown> | undefined)?.a_sgst}
                    cess={(table4 as Record<string, unknown> | undefined)?.a_cess}
                  />
                  <TableRow
                    label="(D) Reversals of ITC"
                    igst={(table4 as Record<string, unknown> | undefined)?.d_igst}
                    cgst={(table4 as Record<string, unknown> | undefined)?.d_cgst}
                    sgst={(table4 as Record<string, unknown> | undefined)?.d_sgst}
                  />
                  <TableRow
                    label="Net ITC Available"
                    igst={(table4 as Record<string, unknown> | undefined)?.net_igst}
                    cgst={(table4 as Record<string, unknown> | undefined)?.net_cgst}
                    sgst={(table4 as Record<string, unknown> | undefined)?.net_sgst}
                    cess={(table4 as Record<string, unknown> | undefined)?.net_cess}
                    bold
                  />
                </tbody>
              </table>
            </div>
          </Section>

          {/* ITC Set-off summary */}
          {itcSetoff && (
            <Section title="ITC Set-off Computation (per GST Act S.49)">
              <div className="px-5 py-4">
                <div className="flex items-start gap-2 mb-4 text-xs text-brand bg-primary-subtle rounded-lg px-3 py-2">
                  <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>
                    Set-off order: IGST liability → IGST ITC → CGST ITC → SGST ITC. CGST liability
                    uses IGST then CGST only (never SGST). SGST liability uses IGST then SGST only
                    (never CGST).
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                  {(['igst', 'cgst', 'sgst'] as const).map((t) => {
                    const so = (itcSetoff.setoffBreakdown as Record<string, unknown> | undefined)?.[
                      t
                    ] as Record<string, unknown> | undefined;
                    const cash = (itcSetoff.cashRequired as Record<string, unknown> | undefined)?.[
                      t
                    ];
                    return (
                      <div key={t} className="bg-surface-subtle rounded-lg p-4">
                        <div className="text-xs font-medium text-secondary uppercase mb-3">
                          {t.toUpperCase()} Liability
                        </div>
                        {so &&
                          Object.entries(so).map(([k, v]) => (
                            <div
                              key={k}
                              className="flex justify-between text-xs text-secondary mb-1"
                            >
                              <span>{k.replace(/_/g, ' ')}</span>
                              <span>{formatCurrency(v)}</span>
                            </div>
                          ))}
                        {cash !== undefined && Number(cash) > 0 && (
                          <div className="mt-2 pt-2 border-t border-default flex justify-between text-xs font-semibold text-danger">
                            <span>Cash required</span>
                            <span>{formatCurrency(cash)}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 flex justify-between items-center px-4 py-3 bg-warning-bg rounded-lg border border-warning">
                  <span className="text-sm font-medium text-warning">
                    Total Cash Required (GST payable)
                  </span>
                  <span className="text-lg font-bold text-warning">
                    {formatCurrency(
                      Number(
                        (itcSetoff.cashRequired as Record<string, unknown> | undefined)?.igst ?? 0
                      ) +
                        Number(
                          (itcSetoff.cashRequired as Record<string, unknown> | undefined)?.cgst ?? 0
                        ) +
                        Number(
                          (itcSetoff.cashRequired as Record<string, unknown> | undefined)?.sgst ?? 0
                        )
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
