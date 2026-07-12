import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { statutoryApi, employeeApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Select from '../../components/ui/Select.js';
import Button from '../../components/ui/Button.js';
import { formatCurrency } from '../../lib/format.js';

interface Employee {
  id: number;
  displayName: string;
}

interface Form16MonthlyBreakdown {
  periodMonth: number;
  periodYear: number;
  gross: number;
  tds: number;
  pf: number;
  esi: number;
}

interface Form16Data {
  employeeName: string;
  pan: string | null;
  employerName: string;
  employerTAN: string | null;
  grossSalary: number;
  standardDeduction: number;
  taxableIncome: number;
  totalTDSDeducted: number;
  monthlyBreakdown: Form16MonthlyBreakdown[];
}

function defaultFinancialYear(): string {
  const now = new Date();
  const startYear = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

export default function Form16Page() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [employeeId, setEmployeeId] = useState('');
  const [financialYear, setFinancialYear] = useState(defaultFinancialYear());

  const { data: empData } = useQuery({
    queryKey: ['employees-all'],
    queryFn: () => employeeApi.list(),
    enabled: hasPermission(PERMISSIONS.EMPLOYEE_VIEW),
  });
  const employees: Employee[] = ((empData as Record<string, unknown>)?.content as Employee[]) ?? [];

  const { data, isFetching, refetch, isFetched } = useQuery({
    queryKey: ['form16', employeeId, financialYear],
    queryFn: () => statutoryApi.form16(Number(employeeId), financialYear),
    enabled: false,
  });
  const form16 = data as unknown as Form16Data | undefined;

  function handleDownload() {
    if (!form16) return;
    const blob = new Blob([JSON.stringify(form16, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `form16-${employeeId}-${financialYear}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Form 16 (Part B)"
        subtitle="Annual salary, deductions and TDS summary per employee."
        actions={
          form16 && (
            <Button variant="secondary" onClick={handleDownload}>
              Download
            </Button>
          )
        }
      />

      <div className="flex gap-4 mb-5 items-end max-w-2xl flex-wrap">
        <div className="flex-1">
          <Select
            label="Employee"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          >
            <option value="">Select employee…</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.displayName}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex-1">
          <Select
            label="Financial Year"
            value={financialYear}
            onChange={(e) => setFinancialYear(e.target.value)}
          >
            {[0, 1, 2].map((i) => {
              const now = new Date();
              const base = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
              const startYear = base - i;
              const fy = `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
              return (
                <option key={fy} value={fy}>
                  {fy}
                </option>
              );
            })}
          </Select>
        </div>
        <Button onClick={() => refetch()} disabled={!employeeId} loading={isFetching}>
          Generate
        </Button>
      </div>

      {isFetched && !form16 && (
        <ERPEmptyState
          type="no-results"
          title="No payroll data found"
          description="No payroll data found for this employee and financial year."
        />
      )}

      {form16 && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="bg-surface-card rounded-xl border border-default p-5">
              <h3 className="font-semibold text-primary mb-4">Employee</h3>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-secondary">Name</dt>
                  <dd>{form16.employeeName}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-secondary">PAN</dt>
                  <dd>{form16.pan ?? '–'}</dd>
                </div>
              </dl>
            </div>
            <div className="bg-surface-card rounded-xl border border-default p-5">
              <h3 className="font-semibold text-primary mb-4">Employer</h3>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-secondary">Name</dt>
                  <dd>{form16.employerName}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-secondary">TAN</dt>
                  <dd>{form16.employerTAN ?? '–'}</dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="bg-surface-card rounded-xl border border-default p-5">
            <h3 className="font-semibold text-primary mb-4">Summary (FY {financialYear})</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <dt className="text-secondary">Gross Salary</dt>
                <dd className="font-mono font-semibold">{formatCurrency(form16.grossSalary)}</dd>
              </div>
              <div>
                <dt className="text-secondary">Standard Deduction</dt>
                <dd className="font-mono font-semibold">
                  {formatCurrency(form16.standardDeduction)}
                </dd>
              </div>
              <div>
                <dt className="text-secondary">Taxable Income</dt>
                <dd className="font-mono font-semibold">{formatCurrency(form16.taxableIncome)}</dd>
              </div>
              <div>
                <dt className="text-secondary">Total TDS</dt>
                <dd className="font-mono font-semibold">
                  {formatCurrency(form16.totalTDSDeducted)}
                </dd>
              </div>
            </div>
          </div>

          <div className="bg-surface-card rounded-xl border border-default overflow-hidden">
            <h3 className="font-semibold text-primary p-5 pb-0">Monthly Breakdown</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm mt-4">
                <thead className="bg-surface-subtle">
                  <tr className="text-left text-xs uppercase text-secondary">
                    <th className="px-4 py-3">Period</th>
                    <th className="px-4 py-3 text-right">Gross</th>
                    <th className="px-4 py-3 text-right">PF</th>
                    <th className="px-4 py-3 text-right">ESI</th>
                    <th className="px-4 py-3 text-right">TDS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-default">
                  {form16.monthlyBreakdown.map((m) => (
                    <tr key={`${m.periodYear}-${m.periodMonth}`}>
                      <td className="px-4 py-3">
                        {String(m.periodMonth).padStart(2, '0')}/{m.periodYear}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">{formatCurrency(m.gross)}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatCurrency(m.pf)}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatCurrency(m.esi)}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatCurrency(m.tds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
