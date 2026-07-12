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

interface PFChallanRow {
  employeeId: number;
  uan: string | null;
  employeeName: string;
  basicSalary: number;
  epfEmployee: number;
  epfEmployer: number;
  epsAmount: number;
}

interface PFChallanData {
  periodMonth: number;
  periodYear: number;
  rows: PFChallanRow[];
  totals: { basicSalary: number; epfEmployee: number; epfEmployer: number; epsAmount: number };
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

export default function PFChallanPage() {
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  const { data, isLoading } = useQuery({
    queryKey: ['pf-challan', month, year],
    // No payroll run for the selected period is an expected, actionable state, not a
    // surprise error — replace the raw "PayrollRun not found" 404 with guidance the
    // user can act on before it reaches the global QueryCache error toast in main.tsx.
    queryFn: async () => {
      try {
        return await statutoryApi.pfChallan(month, year);
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
  const challan = data as unknown as PFChallanData | undefined;

  const markFiledMutation = useMutation({
    mutationFn: () => statutoryApi.markPfFiled(month, year),
    onSuccess: () => {
      toast.success('PF challan marked as filed');
      qc.invalidateQueries({ queryKey: ['pf-challan', month, year] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function handleExport() {
    const blob = await statutoryApi.pfChallanExport(month, year);
    downloadBlob(blob, `pf-challan-${year}-${String(month).padStart(2, '0')}.csv`);
  }

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="PF Challan"
        subtitle="Monthly EPF contribution summary for EPFO filing."
        actions={
          <div className="flex gap-2 flex-wrap">
            {hasPermission(PERMISSIONS.HR_STATUTORY) && (
              <Button variant="secondary" onClick={handleExport} disabled={!challan?.rows.length}>
                Download for EPFO Portal
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
        <ERPTableSkeleton rows={6} cols={6} />
      ) : !challan?.rows.length ? (
        <ERPEmptyState
          type="no-data"
          title="No PF-applicable payroll data"
          description="Run and calculate payroll for this period first."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm bg-surface-card rounded-xl border border-default overflow-hidden">
            <thead className="bg-surface-subtle">
              <tr className="text-left text-xs uppercase text-secondary">
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">UAN</th>
                <th className="px-4 py-3 text-right">Basic</th>
                <th className="px-4 py-3 text-right">EPF Employee</th>
                <th className="px-4 py-3 text-right">EPF Employer</th>
                <th className="px-4 py-3 text-right">EPS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-default">
              {challan.rows.map((r) => (
                <tr key={r.employeeId}>
                  <td className="px-4 py-3">{r.employeeName}</td>
                  <td className="px-4 py-3 text-secondary">{r.uan ?? '–'}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    {formatCurrency(r.basicSalary)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {formatCurrency(r.epfEmployee)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {formatCurrency(r.epfEmployer)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{formatCurrency(r.epsAmount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-surface-subtle font-semibold">
              <tr>
                <td className="px-4 py-3" colSpan={2}>
                  Total
                </td>
                <td className="px-4 py-3 text-right font-mono">
                  {formatCurrency(challan.totals.basicSalary)}
                </td>
                <td className="px-4 py-3 text-right font-mono">
                  {formatCurrency(challan.totals.epfEmployee)}
                </td>
                <td className="px-4 py-3 text-right font-mono">
                  {formatCurrency(challan.totals.epfEmployer)}
                </td>
                <td className="px-4 py-3 text-right font-mono">
                  {formatCurrency(challan.totals.epsAmount)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
