import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  FileText,
  CheckCircle,
  AlertTriangle,
  Download,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
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

interface SectionCardProps {
  title: string;
  subtitle: string;
  count: number;
  amount: number;
  children: React.ReactNode;
}

function SectionCard({ title, subtitle, count, amount, children }: SectionCardProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-surface-card border border-default rounded-xl">
      <button
        className="w-full flex items-center justify-between px-5 py-4 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-primary">{title}</span>
            <span className="px-2 py-0.5 text-xs bg-surface-raised text-secondary rounded-full">
              {count}
            </span>
          </div>
          <div className="text-xs text-secondary mt-0.5">{subtitle}</div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-primary">{formatCurrency(amount)}</span>
          {open ? (
            <ChevronDown className="w-4 h-4 text-secondary" />
          ) : (
            <ChevronRight className="w-4 h-4 text-secondary" />
          )}
        </div>
      </button>
      {open && <div className="border-t border-default px-5 py-4">{children}</div>}
    </div>
  );
}

export function Gstr1Page() {
  const canFileGstr1 = useAuthStore((s) => s.hasPermission(PERMISSIONS.GSTR1_FILE));
  const [period, setPeriod] = useState(getCurrentPeriod());
  const [gstin, setGstin] = useState('');

  const { data: gstr1Data, isLoading } = useQuery({
    queryKey: ['gstr1', period],
    queryFn: () => gstApi.gstr1(period),
  });

  const exportMutation = useMutation({
    mutationFn: (format: 'JSON' | 'EXCEL') =>
      gstApi.exportGstr1(period, format, gstin || undefined),
    onSuccess: (res, format) => {
      if (format === 'JSON') {
        const json = JSON.stringify(res, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `GSTR1_${period}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success('GSTR-1 JSON exported');
      } else {
        toast.success('GSTR-1 data exported');
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sections = gstr1Data?.sections as Record<string, unknown> | undefined;
  const validationErrors = gstr1Data?.validationErrors ?? [];
  const b2bEntries = (sections?.b2b as unknown[]) ?? [];
  const b2csEntries = (sections?.b2cs as unknown[]) ?? [];
  const cdnrEntries = (sections?.cdnr as unknown[]) ?? [];
  const hsnData = (sections?.hsn as { data?: unknown[] })?.data ?? [];

  const totalOutward = b2bEntries.length + b2csEntries.length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText className="w-6 h-6 text-brand" />
          <div>
            <h1 className="text-xl font-semibold text-primary">GSTR-1</h1>
            <p className="text-sm text-secondary">Outward Supplies Return</p>
          </div>
        </div>
        <div className="flex gap-2">
          {canFileGstr1 && (
            <Button
              variant="primary"
              onClick={() => exportMutation.mutate('JSON')}
              disabled={!gstr1Data?.isExportReady || exportMutation.isPending}
            >
              <Download size={16} />
              Export JSON (NIC)
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-4 items-end">
        <div>
          <MonthPicker label="Period" value={period} onChange={setPeriod} />
        </div>
        <div>
          <label className="block text-xs font-medium text-primary mb-1">
            Your GSTIN (for export)
          </label>
          <input
            type="text"
            value={gstin}
            onChange={(e) => setGstin(e.target.value.toUpperCase())}
            placeholder="15-char GSTIN"
            maxLength={15}
            className="px-3 py-2 text-sm bg-surface-card border border-default rounded-lg text-primary font-mono focus:outline-none focus:ring-2 focus:ring-focus w-48"
          />
        </div>
      </div>

      {/* Validation status */}
      {!isLoading && gstr1Data && (
        <div
          className={`flex items-start gap-3 px-4 py-3 rounded-lg ${
            gstr1Data.isExportReady
              ? 'bg-success-bg border border-success'
              : 'bg-warning-bg border border-warning'
          }`}
        >
          {gstr1Data.isExportReady ? (
            <CheckCircle className="w-5 h-5 text-success flex-shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
          )}
          <div>
            {gstr1Data.isExportReady ? (
              <p className="text-sm font-medium text-success">
                Ready to export — {totalOutward} invoices in GSTR-1
              </p>
            ) : (
              <>
                <p className="text-sm font-medium text-warning">
                  Validation issues ({validationErrors.length})
                </p>
                <ul className="mt-1 space-y-0.5">
                  {(validationErrors as string[]).map((e, i) => (
                    <li key={i} className="text-xs text-warning">
                      • {e}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          <ERPCardSkeleton lines={2} />
          <ERPCardSkeleton lines={2} />
          <ERPCardSkeleton lines={2} />
          <ERPCardSkeleton lines={2} />
        </div>
      ) : (
        <div className="space-y-3">
          <SectionCard
            title="B2B — Registered Customers"
            subtitle="Tax invoices to GSTIN-registered buyers"
            count={b2bEntries.length}
            amount={b2bEntries.reduce(
              (acc: number, e) => acc + Number((e as Record<string, unknown>).totalGst ?? 0),
              0
            )}
          >
            {b2bEntries.length === 0 ? (
              <p className="text-sm text-secondary">No B2B invoices</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="text-secondary">
                      <th className="py-2 pr-4 text-left font-medium">Invoice No</th>
                      <th className="py-2 pr-4 text-left font-medium">Date</th>
                      <th className="py-2 pr-4 text-left font-medium">Buyer GSTIN</th>
                      <th className="py-2 pr-4 text-right font-medium">Taxable</th>
                      <th className="py-2 text-right font-medium">Tax</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-default">
                    {b2bEntries.map((e, i) => {
                      const r = e as Record<string, unknown>;
                      return (
                        <tr key={i} className="text-primary">
                          <td className="py-2 pr-4 font-mono">{String(r.documentNumber ?? '')}</td>
                          <td className="py-2 pr-4">{String(r.documentDate ?? '')}</td>
                          <td className="py-2 pr-4 font-mono">
                            {String(r.gstinOfCounterparty ?? '')}
                          </td>
                          <td className="py-2 pr-4 text-right">
                            {formatCurrency(r.taxableAmount)}
                          </td>
                          <td className="py-2 text-right">{formatCurrency(r.totalGst)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="B2CS — Unregistered (≤₹2.5L, intrastate)"
            subtitle="Small unregistered buyer invoices, grouped by rate"
            count={b2csEntries.length}
            amount={b2csEntries.reduce(
              (acc: number, e) => acc + Number((e as Record<string, unknown>).totalGst ?? 0),
              0
            )}
          >
            {b2csEntries.length === 0 ? (
              <p className="text-sm text-secondary">No B2CS entries</p>
            ) : (
              <pre className="text-xs text-secondary overflow-x-auto">
                {JSON.stringify(b2csEntries, null, 2)}
              </pre>
            )}
          </SectionCard>

          <SectionCard
            title="CDNR — Credit / Debit Notes (Registered)"
            subtitle="Credit notes issued to registered customers"
            count={cdnrEntries.length}
            amount={cdnrEntries.reduce(
              (acc: number, e) => acc + Number((e as Record<string, unknown>).totalGst ?? 0),
              0
            )}
          >
            {cdnrEntries.length === 0 ? (
              <p className="text-sm text-secondary">No credit/debit notes</p>
            ) : (
              <pre className="text-xs text-secondary overflow-x-auto">
                {JSON.stringify(cdnrEntries, null, 2)}
              </pre>
            )}
          </SectionCard>

          <SectionCard
            title="HSN Summary"
            subtitle="Aggregate supplies by HSN code"
            count={hsnData.length}
            amount={0}
          >
            {hsnData.length === 0 ? (
              <p className="text-sm text-secondary">No HSN data</p>
            ) : (
              <pre className="text-xs text-secondary overflow-x-auto">
                {JSON.stringify(hsnData, null, 2)}
              </pre>
            )}
          </SectionCard>
        </div>
      )}
    </div>
  );
}
