import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { tailorWorkLogApi, employeeApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPErrorBoundary from '../../components/erp/ERPErrorBoundary.js';
import ERPFormSection from '../../components/erp/ERPFormSection.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import { formatCurrency, formatDate } from '../../lib/format.js';

interface TailorEmployee {
  id: number;
  displayName: string;
  employeeCode: string;
}

interface WorkLogEntry {
  id: number;
  employeeId: number;
  workDate: string;
  taskDescription: string;
  units: string;
  ratePerUnit: string;
  amount: string;
}

interface SummaryRow {
  employeeId: number;
  totalAmount: string;
  totalUnits: string;
  entryCount: string;
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default function TailorWorkLogPage() {
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canLog = hasPermission(PERMISSIONS.ALTERATION_UPDATE);
  const [month, setMonth] = useState(currentMonth());
  const [employeeId, setEmployeeId] = useState('');
  const [workDate, setWorkDate] = useState(new Date().toISOString().slice(0, 10));
  const [taskDescription, setTaskDescription] = useState('');
  const [units, setUnits] = useState('1');
  const [ratePerUnit, setRatePerUnit] = useState('');

  const { data: employeesData } = useQuery({
    queryKey: ['employees', 'TAILOR'],
    queryFn: () => employeeApi.list({ employmentType: 'TAILOR', size: 100 }),
  });
  const tailors: TailorEmployee[] =
    ((employeesData as Record<string, unknown>)?.content as TailorEmployee[]) ?? [];

  const { data: entriesData, isLoading: entriesLoading } = useQuery({
    queryKey: ['tailor-work-log', employeeId, month],
    queryFn: () => tailorWorkLogApi.list(Number(employeeId), month),
    enabled: !!employeeId,
  });
  const entries: WorkLogEntry[] =
    ((entriesData as Record<string, unknown>)?.content as WorkLogEntry[]) ?? [];

  const { data: summaryData } = useQuery({
    queryKey: ['tailor-work-log-summary', month],
    queryFn: () => tailorWorkLogApi.summary(month),
  });
  const summary: SummaryRow[] =
    ((summaryData as Record<string, unknown>)?.content as SummaryRow[]) ?? [];

  const logMutation = useMutation({
    mutationFn: () =>
      tailorWorkLogApi.log({
        employeeId: Number(employeeId),
        workDate,
        taskDescription,
        units: parseFloat(units),
        ratePerUnit: parseFloat(ratePerUnit),
      }),
    onSuccess: () => {
      toast.success('Work logged');
      setTaskDescription('');
      setRatePerUnit('');
      qc.invalidateQueries({ queryKey: ['tailor-work-log', employeeId, month] });
      qc.invalidateQueries({ queryKey: ['tailor-work-log-summary', month] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const employeeName = (id: number) =>
    tailors.find((t) => t.id === id)?.displayName ?? `Employee #${id}`;

  return (
    <ERPErrorBoundary>
      <div>
        <ERPPageHeader
          variant="list"
          title="Tailor Work Log"
          subtitle="Piece-rate work entries — flows into payroll as each tailor's piece-rate amount."
          actions={
            <Input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="w-40"
            />
          }
        />

        {canLog && (
          <div className="mb-6">
            <ERPFormSection title="Log Work" columns={1}>
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                <Select
                  label="Tailor"
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                >
                  <option value="">Select…</option>
                  {tailors.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.displayName} ({t.employeeCode})
                    </option>
                  ))}
                </Select>
                <Input
                  label="Work Date"
                  type="date"
                  value={workDate}
                  onChange={(e) => setWorkDate(e.target.value)}
                />
                <Input
                  label="Task"
                  value={taskDescription}
                  onChange={(e) => setTaskDescription(e.target.value)}
                />
                <Input
                  label="Units"
                  type="number"
                  value={units}
                  onChange={(e) => setUnits(e.target.value)}
                />
                <Input
                  label="Rate / Unit"
                  type="number"
                  step="0.01"
                  value={ratePerUnit}
                  onChange={(e) => setRatePerUnit(e.target.value)}
                />
                <div className="sm:col-span-5">
                  <Button
                    disabled={
                      !employeeId || !taskDescription || !ratePerUnit || logMutation.isPending
                    }
                    onClick={() => logMutation.mutate()}
                  >
                    {logMutation.isPending ? 'Saving…' : 'Log Work'}
                  </Button>
                </div>
              </div>
            </ERPFormSection>
          </div>
        )}

        {employeeId && (
          <div className="mb-6">
            <ERPFormSection title={`Entries — ${employeeName(Number(employeeId))}`} columns={1}>
              {entriesLoading ? (
                <ERPTableSkeleton rows={3} cols={4} />
              ) : entries.length === 0 ? (
                <p className="text-sm text-secondary">No entries for this employee/month yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-secondary text-xs uppercase">
                      <th className="py-2">Date</th>
                      <th className="py-2">Task</th>
                      <th className="py-2 text-right">Units</th>
                      <th className="py-2 text-right">Rate</th>
                      <th className="py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-default">
                    {entries.map((e) => (
                      <tr key={e.id}>
                        <td className="py-2">{formatDate(e.workDate)}</td>
                        <td className="py-2">{e.taskDescription}</td>
                        <td className="py-2 text-right">{e.units}</td>
                        <td className="py-2 text-right">{formatCurrency(Number(e.ratePerUnit))}</td>
                        <td className="py-2 text-right font-semibold">
                          {formatCurrency(Number(e.amount))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </ERPFormSection>
          </div>
        )}

        <ERPFormSection title="Monthly Summary — All Tailors" columns={1}>
          {summary.length === 0 ? (
            <ERPEmptyState
              type="no-data"
              title="No work logged for this month yet"
              description="Piece-rate totals per tailor will appear here once entries are logged."
            />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-secondary text-xs uppercase">
                  <th className="py-2">Tailor</th>
                  <th className="py-2 text-right">Entries</th>
                  <th className="py-2 text-right">Total Units</th>
                  <th className="py-2 text-right">Total Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-default">
                {summary.map((s) => (
                  <tr key={s.employeeId}>
                    <td className="py-2">{employeeName(s.employeeId)}</td>
                    <td className="py-2 text-right">{s.entryCount}</td>
                    <td className="py-2 text-right">{s.totalUnits}</td>
                    <td className="py-2 text-right font-semibold">
                      {formatCurrency(Number(s.totalAmount))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ERPFormSection>
      </div>
    </ERPErrorBoundary>
  );
}
