import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { FileSpreadsheet, Download, AlertTriangle, CheckCircle } from 'lucide-react';
import { gstApi } from '../../api/endpoints.js';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import { ERPCardSkeleton } from '../../components/erp/ERPSkeleton.js';
import Button from '../../components/ui/Button.js';

function getCurrentFy(): string {
  const now = new Date();
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${year}-${String(year + 1).slice(2)}`;
}

function formatCurrency(val: unknown): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(Number(val ?? 0));
}

interface AmountCardProps {
  title: string;
  rows: { label: string; value: unknown }[];
  total?: unknown;
}

function AmountCard({ title, rows, total }: AmountCardProps) {
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">{title}</h3>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div
            key={r.label}
            className="flex justify-between text-sm text-gray-600 dark:text-gray-400"
          >
            <span>{r.label}</span>
            <span className="font-mono">{formatCurrency(r.value)}</span>
          </div>
        ))}
      </div>
      {total !== undefined && (
        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 flex justify-between text-sm font-semibold text-gray-900 dark:text-white">
          <span>Total</span>
          <span className="font-mono">{formatCurrency(total)}</span>
        </div>
      )}
    </div>
  );
}

export function GSTR9Page() {
  const canFileGstr9 = useAuthStore((s) => s.hasPermission(PERMISSIONS.GSTR9_FILE));
  const canViewGstCalendar = useAuthStore((s) => s.hasPermission(PERMISSIONS.GST_VIEW));
  const [year, setYear] = useState(getCurrentFy());

  const { data: result, isLoading } = useQuery({
    queryKey: ['gstr9', year],
    queryFn: () => gstApi.gstr9(year),
    select: (r) => r as Record<string, unknown>,
  });

  const { data: calendarData } = useQuery({
    queryKey: ['gst-returns-calendar', year],
    queryFn: () => gstApi.returnsCalendar(year),
    enabled: canViewGstCalendar,
  });

  const exportMutation = useMutation({
    mutationFn: () => gstApi.exportGstr9(year),
    onSuccess: (res) => {
      const json = JSON.stringify(res, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `GSTR9_${year}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('GSTR-9 exported');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const table4 = result?.table4 as Record<string, unknown> | undefined;
  const table5 = result?.table5 as Record<string, unknown> | undefined;
  const table6 = result?.table6 as Record<string, unknown> | undefined;
  const table7 = result?.table7 as Record<string, unknown> | undefined;
  const table9 = result?.table9 as Record<string, unknown> | undefined;
  const paidInCash = table9?.paidInCash as Record<string, unknown> | undefined;
  const paidThroughItc = table9?.paidThroughItc as Record<string, unknown> | undefined;
  const table9Complete = result?.table9Complete as boolean | undefined;
  const unfiledPeriods = (result?.unfiledPeriods as string[] | undefined) ?? [];
  const inwardSupplies = table6?.inwardSupplies as Record<string, unknown> | undefined;
  const rcm = table6?.rcm as Record<string, unknown> | undefined;
  const table6Total = table6?.total as Record<string, unknown> | undefined;

  const calendar =
    (calendarData as { calendar?: Record<string, unknown>[] } | undefined)?.calendar ?? [];
  const unfiled = calendar.filter(
    (e) => e.status !== 'FILED' && e.status !== 'LATE_FILED' && e.status !== 'NIL_FILED'
  );
  const filingReady = calendar.length > 0 && unfiled.length === 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileSpreadsheet className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white">GSTR-9</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Annual Return</p>
          </div>
        </div>
        {canFileGstr9 && (
          <Button
            variant="primary"
            onClick={() => exportMutation.mutate()}
            disabled={exportMutation.isPending || !result}
          >
            <Download size={16} />
            Download JSON
          </Button>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
          Financial Year
        </label>
        <input
          type="text"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          placeholder="2025-26"
          pattern="\d{4}-\d{2}"
          className="px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 w-36"
        />
      </div>

      {/* Prepare Filing status */}
      {calendar.length > 0 && (
        <div
          className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${
            filingReady
              ? 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20'
              : 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20'
          }`}
        >
          {filingReady ? (
            <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          )}
          <div className="text-sm">
            <p
              className={`font-medium ${filingReady ? 'text-green-800 dark:text-green-300' : 'text-amber-800 dark:text-amber-300'}`}
            >
              {filingReady
                ? 'Ready to prepare filing'
                : `${unfiled.length} GSTR-1 / GSTR-3B return(s) not yet filed for ${year}`}
            </p>
            {!filingReady && (
              <p className="text-amber-700 dark:text-amber-400 mt-0.5">
                File all monthly GSTR-1 and GSTR-3B returns for the year before filing GSTR-9. See
                the GST Compliance Calendar.
              </p>
            )}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <ERPCardSkeleton lines={5} />
          <ERPCardSkeleton lines={1} />
          <ERPCardSkeleton lines={4} />
          <ERPCardSkeleton lines={4} />
          <ERPCardSkeleton lines={4} />
          <ERPCardSkeleton lines={4} />
        </div>
      ) : !result ? (
        <div className="py-12 text-center text-sm text-gray-400 dark:text-gray-500">
          No data for selected year
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <AmountCard
            title="Table 4 — Taxable Outward Supplies"
            rows={[
              { label: 'Taxable Value', value: table4?.taxableValue },
              { label: 'CGST', value: table4?.cgst },
              { label: 'SGST', value: table4?.sgst },
              { label: 'IGST', value: table4?.igst },
              { label: 'Cess', value: table4?.cess },
            ]}
            total={table4?.total}
          />
          <AmountCard
            title="Table 5 — Nil-rated / Exempt / Non-GST Outward Supplies"
            rows={[{ label: 'Taxable Value', value: table5?.taxableValue }]}
          />
          <AmountCard
            title="Table 6 — ITC Availed (Inward Supplies)"
            rows={[
              { label: 'IGST', value: inwardSupplies?.igst },
              { label: 'CGST', value: inwardSupplies?.cgst },
              { label: 'SGST', value: inwardSupplies?.sgst },
              { label: 'Cess', value: inwardSupplies?.cess },
            ]}
          />
          <AmountCard
            title="Table 6 — ITC Availed (RCM)"
            rows={[
              { label: 'IGST', value: rcm?.igst },
              { label: 'CGST', value: rcm?.cgst },
              { label: 'SGST', value: rcm?.sgst },
              { label: 'Cess', value: rcm?.cess },
            ]}
            total={
              table6Total
                ? Number(table6Total.igst ?? 0) +
                  Number(table6Total.cgst ?? 0) +
                  Number(table6Total.sgst ?? 0) +
                  Number(table6Total.cess ?? 0)
                : undefined
            }
          />
          <AmountCard
            title="Table 7 — ITC Reversed"
            rows={[
              { label: 'IGST', value: table7?.igst },
              { label: 'CGST', value: table7?.cgst },
              { label: 'SGST', value: table7?.sgst },
              { label: 'Cess', value: table7?.cess },
            ]}
          />
          <AmountCard
            title="Table 9 — Tax Paid in Cash"
            rows={[
              { label: 'IGST', value: paidInCash?.igst },
              { label: 'CGST', value: paidInCash?.cgst },
              { label: 'SGST', value: paidInCash?.sgst },
              { label: 'Cess', value: paidInCash?.cess },
            ]}
            total={paidInCash?.total}
          />
          <AmountCard
            title="Table 9 — Tax Paid through ITC"
            rows={[
              { label: 'IGST', value: paidThroughItc?.igst },
              { label: 'CGST', value: paidThroughItc?.cgst },
              { label: 'SGST', value: paidThroughItc?.sgst },
              { label: 'Cess', value: paidThroughItc?.cess },
            ]}
            total={paidThroughItc?.total}
          />
        </div>
      )}

      {result && table9Complete === false && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-4 py-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-amber-800 dark:text-amber-300">
              Table 9 reflects {12 - unfiledPeriods.length} of 12 filed periods
            </p>
            <p className="text-amber-700 dark:text-amber-400 mt-0.5">
              {unfiledPeriods.length} period(s) not yet filed (or filed before real tax-paid
              tracking was in place) are excluded: {unfiledPeriods.join(', ')}.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
