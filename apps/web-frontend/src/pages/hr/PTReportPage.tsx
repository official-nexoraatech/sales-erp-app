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

interface PTReportRow {
  employeeId: number;
  employeeName: string;
  grossSalary: number;
  professionalTax: number;
}

interface PTReportData {
  periodMonth: number;
  periodYear: number;
  rows: PTReportRow[];
  totals: { professionalTax: number };
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

export default function PTReportPage() {
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  const { data, isLoading } = useQuery({
    queryKey: ['pt-report', month, year],
    queryFn: async () => {
      try {
        return await statutoryApi.ptReport(month, year);
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
  const report = data as unknown as PTReportData | undefined;

  const markFiledMutation = useMutation({
    mutationFn: () => statutoryApi.markPtFiled(month, year),
    onSuccess: () => {
      toast.success('PT report marked as filed');
      qc.invalidateQueries({ queryKey: ['pt-report', month, year] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function handleExport() {
    const blob = await statutoryApi.ptReportExport(month, year);
    downloadBlob(blob, `pt-report-${year}-${String(month).padStart(2, '0')}.csv`);
  }

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Professional Tax Report"
        subtitle="Monthly Professional Tax deduction summary, state-resolved per employee."
        actions={
          <div className="flex gap-2 flex-wrap">
            {hasPermission(PERMISSIONS.HR_STATUTORY) && (
              <Button variant="secondary" onClick={handleExport} disabled={!report?.rows.length}>
                Download CSV
              </Button>
            )}
            {hasPermission(PERMISSIONS.HR_STATUTORY) && !report?.filedAt && (
              <Button
                onClick={() => markFiledMutation.mutate()}
                loading={markFiledMutation.isPending}
                disabled={!report?.rows.length}
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

      {report?.filedAt && (
        <div className="mb-4">
          <Badge variant="success">Filed on {new Date(report.filedAt).toLocaleDateString()}</Badge>
        </div>
      )}

      {isLoading ? (
        <ERPTableSkeleton rows={6} cols={3} />
      ) : !report?.rows.length ? (
        <ERPEmptyState
          type="no-data"
          title="No PT-applicable payroll data"
          description="Run and calculate payroll for this period first."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm bg-surface-card rounded-xl border border-default overflow-hidden">
            <thead className="bg-surface-subtle">
              <tr className="text-left text-xs uppercase text-secondary">
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3 text-right">Gross Salary</th>
                <th className="px-4 py-3 text-right">Professional Tax</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-default">
              {report.rows.map((r) => (
                <tr key={r.employeeId}>
                  <td className="px-4 py-3">{r.employeeName}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    {formatCurrency(r.grossSalary)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {formatCurrency(r.professionalTax)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-surface-subtle font-semibold">
              <tr>
                <td className="px-4 py-3">Total</td>
                <td className="px-4 py-3"></td>
                <td className="px-4 py-3 text-right font-mono">
                  {formatCurrency(report.totals.professionalTax)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
