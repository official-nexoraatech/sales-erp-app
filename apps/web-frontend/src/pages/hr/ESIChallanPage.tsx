import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { statutoryApi } from '../../api/endpoints.js';
import { ApiError } from '../../api/client.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Input from '../../components/ui/Input.js';
import Badge from '../../components/ui/Badge.js';
import { formatCurrency } from '../../lib/format.js';

interface ESIChallanRow {
  employeeId: number;
  esiNumber: string | null;
  employeeName: string;
  grossSalary: number;
  esiEmployee: number;
  esiEmployer: number;
}

interface ESIChallanData {
  periodMonth: number;
  periodYear: number;
  rows: ESIChallanRow[];
  totals: { grossSalary: number; esiEmployee: number; esiEmployer: number };
  filedAt: string | null;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ESIChallanPage() {
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  const { data, isLoading } = useQuery({
    queryKey: ['esi-challan', month, year],
    // No payroll run for the selected period is an expected, actionable state, not a
    // surprise error — replace the raw "PayrollRun not found" 404 with guidance the
    // user can act on before it reaches the global QueryCache error toast in main.tsx.
    queryFn: async () => {
      try {
        return await statutoryApi.esiChallan(month, year);
      } catch (err) {
        if (err instanceof ApiError && err.statusCode === 404) {
          throw new Error(
            `No payroll run found for ${MONTH_NAMES[month - 1]} ${year}. Run payroll for this period first.`
          );
        }
        throw err;
      }
    },
  });
  const challan = data as unknown as ESIChallanData | undefined;

  const markFiledMutation = useMutation({
    mutationFn: () => statutoryApi.markEsiFiled(month, year),
    onSuccess: () => {
      toast.success('ESI challan marked as filed');
      qc.invalidateQueries({ queryKey: ['esi-challan', month, year] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function handleExport() {
    const blob = await statutoryApi.esiChallanExport(month, year);
    downloadBlob(blob, `esi-challan-${year}-${String(month).padStart(2, '0')}.csv`);
  }

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="ESI Challan"
        subtitle="Monthly ESI contribution summary for ESIC filing."
        actions={
          <div className="flex gap-2 flex-wrap">
            {hasPermission(PERMISSIONS.HR_STATUTORY) && (
              <Button variant="secondary" onClick={handleExport} disabled={!challan?.rows.length}>
                Download for ESIC Portal
              </Button>
            )}
            {hasPermission(PERMISSIONS.HR_STATUTORY) && !challan?.filedAt && (
              <Button
                onClick={() => markFiledMutation.mutate()}
                loading={markFiledMutation.isPending}
                disabled={!challan?.rows.length}
              >
                Mark as Filed
              </Button>
            )}
          </div>
        }
      />

      <div className="flex gap-4 mb-5 max-w-md flex-wrap">
        <Input
          label="Month"
          type="number"
          min={1}
          max={12}
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
        />
        <Input
          label="Year"
          type="number"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
        />
      </div>

      {challan?.filedAt && (
        <div className="mb-4">
          <Badge variant="success">Filed on {new Date(challan.filedAt).toLocaleDateString()}</Badge>
        </div>
      )}

      {isLoading ? (
        <ERPTableSkeleton rows={6} cols={5} />
      ) : !challan?.rows.length ? (
        <ERPEmptyState
          type="no-data"
          title="No ESI-applicable payroll data"
          description="Run and calculate payroll for this period first."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm bg-surface-card rounded-xl border border-default overflow-hidden">
            <thead className="bg-surface-subtle">
              <tr className="text-left text-xs uppercase text-secondary">
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">ESI Number</th>
                <th className="px-4 py-3 text-right">Gross Salary</th>
                <th className="px-4 py-3 text-right">ESI Employee</th>
                <th className="px-4 py-3 text-right">ESI Employer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-default">
              {challan.rows.map((r) => (
                <tr key={r.employeeId}>
                  <td className="px-4 py-3">{r.employeeName}</td>
                  <td className="px-4 py-3 text-secondary">{r.esiNumber ?? '–'}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    {formatCurrency(r.grossSalary)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {formatCurrency(r.esiEmployee)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {formatCurrency(r.esiEmployer)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-surface-subtle font-semibold">
              <tr>
                <td className="px-4 py-3" colSpan={2}>
                  Total
                </td>
                <td className="px-4 py-3 text-right font-mono">
                  {formatCurrency(challan.totals.grossSalary)}
                </td>
                <td className="px-4 py-3 text-right font-mono">
                  {formatCurrency(challan.totals.esiEmployee)}
                </td>
                <td className="px-4 py-3 text-right font-mono">
                  {formatCurrency(challan.totals.esiEmployer)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
