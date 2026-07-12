import { Fragment, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { payrollApi, employeeApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Select from '../../components/ui/Select.js';
import Input from '../../components/ui/Input.js';
import Badge from '../../components/ui/Badge.js';
import Modal from '../../components/ui/Modal.js';
import { formatCurrency } from '../../lib/format.js';

interface PayrollRun {
  id: number;
  periodMonth: number;
  periodYear: number;
  status: string;
  totalEmployees: number;
  totalGross: string;
  totalNet: string;
}

interface PayrollSlip {
  id: number;
  employeeId: number;
}

interface Employee {
  id: number;
  displayName: string;
}

const STATUS_VARIANT: Record<string, 'default' | 'warning' | 'success' | 'info'> = {
  DRAFT: 'default',
  CALCULATING: 'warning',
  CALCULATED: 'info',
  APPROVED: 'success',
  DISBURSED: 'success',
};

export default function PayrollPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState<number | null>(null);
  const [periodMonth, setPeriodMonth] = useState(new Date().getMonth() + 1);
  const [periodYear, setPeriodYear] = useState(new Date().getFullYear());
  const [workingDays, setWorkingDays] = useState(26);
  const [salaryModalOpen, setSalaryModalOpen] = useState(false);
  const [salEmployeeId, setSalEmployeeId] = useState('');
  const [salCtc, setSalCtc] = useState('');
  const [salBasic, setSalBasic] = useState('');
  const [salHra, setSalHra] = useState('');
  const [salDa, setSalDa] = useState('');
  const [salGross, setSalGross] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['payroll-runs'],
    queryFn: () => payrollApi.runs(),
  });
  const runs: PayrollRun[] = ((data as Record<string, unknown>)?.content as PayrollRun[]) ?? [];

  const { data: empData } = useQuery({
    queryKey: ['employees-all'],
    queryFn: () => employeeApi.list(),
    enabled: hasPermission(PERMISSIONS.EMPLOYEE_VIEW),
  });
  const employees: Employee[] = ((empData as Record<string, unknown>)?.content as Employee[]) ?? [];

  const { data: runDetailData } = useQuery({
    queryKey: ['payroll-run-detail', expandedRunId],
    queryFn: () => payrollApi.getRun(expandedRunId!),
    enabled: expandedRunId !== null,
  });
  const expandedSlips: PayrollSlip[] = (runDetailData as { slips?: PayrollSlip[] })?.slips ?? [];

  const createMutation = useMutation({
    mutationFn: () => payrollApi.createRun({ periodMonth, periodYear, workingDays }),
    onSuccess: () => {
      toast.success('Payroll run created');
      qc.invalidateQueries({ queryKey: ['payroll-runs'] });
      setCreateOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const calculateMutation = useMutation({
    mutationFn: (id: number) => payrollApi.calculate(id),
    onSuccess: () => {
      toast.success('Payroll calculated');
      qc.invalidateQueries({ queryKey: ['payroll-runs'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => payrollApi.approve(id),
    onSuccess: () => {
      toast.success('Payroll approved');
      qc.invalidateQueries({ queryKey: ['payroll-runs'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const disburseMutation = useMutation({
    mutationFn: (id: number) => payrollApi.disburse(id),
    onSuccess: () => {
      toast.success('Payroll disbursed');
      qc.invalidateQueries({ queryKey: ['payroll-runs'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const salaryMutation = useMutation({
    mutationFn: () =>
      payrollApi.setEmployeeSalary({
        employeeId: Number(salEmployeeId),
        ctc: Number(salCtc),
        basic: Number(salBasic),
        hra: Number(salHra) || 0,
        da: Number(salDa) || 0,
        gross: Number(salGross),
        effectiveFrom: new Date().toISOString().slice(0, 10),
      }),
    onSuccess: () => {
      toast.success('Employee salary set');
      setSalaryModalOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Payroll"
        subtitle="Process monthly payroll runs and manage employee salaries."
        actions={
          <div className="flex gap-2 flex-wrap">
            {hasPermission(PERMISSIONS.PAYROLL_PROCESS) && (
              <Button variant="secondary" onClick={() => setSalaryModalOpen(true)}>
                Set Employee Salary
              </Button>
            )}
            {hasPermission(PERMISSIONS.PAYROLL_PROCESS) && (
              <Button onClick={() => setCreateOpen(true)}>+ New Payroll Run</Button>
            )}
          </div>
        }
      />

      {isLoading ? (
        <ERPTableSkeleton rows={6} cols={6} />
      ) : runs.length === 0 ? (
        <ERPEmptyState
          type="no-data"
          title="No payroll runs yet"
          description="Create your first payroll run to get started."
          {...(hasPermission(PERMISSIONS.PAYROLL_PROCESS)
            ? { action: { label: '+ New Payroll Run', onClick: () => setCreateOpen(true) } }
            : {})}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm bg-surface-card rounded-xl border border-default overflow-hidden">
            <thead className="bg-surface-subtle">
              <tr className="text-left text-xs uppercase text-secondary">
                <th className="px-4 py-3">Period</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Employees</th>
                <th className="px-4 py-3 text-right">Gross</th>
                <th className="px-4 py-3 text-right">Net</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-default">
              {runs.map((run) => (
                <Fragment key={run.id}>
                  <tr>
                    <td className="px-4 py-3 font-medium">
                      {run.periodMonth}/{run.periodYear}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_VARIANT[run.status] ?? 'default'}>{run.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">{run.totalEmployees}</td>
                    <td className="px-4 py-3 text-right font-mono">
                      {formatCurrency(Number(run.totalGross))}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold">
                      {formatCurrency(Number(run.totalNet))}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-2 justify-end">
                        {hasPermission(PERMISSIONS.PAYROLL_PROCESS) &&
                          (run.status === 'DRAFT' || run.status === 'CALCULATED') && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => calculateMutation.mutate(run.id)}
                              loading={calculateMutation.isPending}
                            >
                              Calculate
                            </Button>
                          )}
                        {hasPermission(PERMISSIONS.PAYROLL_APPROVE) &&
                          run.status === 'CALCULATED' && (
                            <Button
                              size="sm"
                              onClick={() => approveMutation.mutate(run.id)}
                              loading={approveMutation.isPending}
                            >
                              Approve
                            </Button>
                          )}
                        {hasPermission(PERMISSIONS.PAYROLL_APPROVE) &&
                          run.status === 'APPROVED' && (
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => disburseMutation.mutate(run.id)}
                              loading={disburseMutation.isPending}
                            >
                              Disburse
                            </Button>
                          )}
                        {(run.status === 'CALCULATED' ||
                          run.status === 'APPROVED' ||
                          run.status === 'DISBURSED') && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              setExpandedRunId(expandedRunId === run.id ? null : run.id)
                            }
                          >
                            {expandedRunId === run.id ? 'Hide Slips' : 'View Slips'}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expandedRunId === run.id && (
                    <tr key={`${run.id}-slips`}>
                      <td colSpan={6} className="px-4 pb-3">
                        {expandedSlips.length === 0 ? (
                          <p className="text-sm text-disabled">No slips found.</p>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {expandedSlips.map((slip) => (
                              <Button
                                key={slip.id}
                                size="sm"
                                variant="secondary"
                                onClick={() => navigate(`/hr/payroll-slips/${slip.id}`)}
                              >
                                Slip #{slip.id}
                              </Button>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New Payroll Run"
        size="sm"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Month"
              type="number"
              min={1}
              max={12}
              value={periodMonth}
              onChange={(e) => setPeriodMonth(Number(e.target.value))}
            />
            <Input
              label="Year"
              type="number"
              value={periodYear}
              onChange={(e) => setPeriodYear(Number(e.target.value))}
            />
          </div>
          <Input
            label="Working Days"
            type="number"
            value={workingDays}
            onChange={(e) => setWorkingDays(Number(e.target.value))}
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => createMutation.mutate()} loading={createMutation.isPending}>
              Create
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={salaryModalOpen}
        onClose={() => setSalaryModalOpen(false)}
        title="Set Employee Salary"
        size="md"
      >
        <div className="space-y-4">
          <Select
            label="Employee"
            value={salEmployeeId}
            onChange={(e) => setSalEmployeeId(e.target.value)}
          >
            <option value="">Select employee…</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.displayName}
              </option>
            ))}
          </Select>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="CTC (Annual)"
              type="number"
              value={salCtc}
              onChange={(e) => setSalCtc(e.target.value)}
            />
            <Input
              label="Gross (Monthly)"
              type="number"
              value={salGross}
              onChange={(e) => setSalGross(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Input
              label="Basic"
              type="number"
              value={salBasic}
              onChange={(e) => setSalBasic(e.target.value)}
            />
            <Input
              label="HRA"
              type="number"
              value={salHra}
              onChange={(e) => setSalHra(e.target.value)}
            />
            <Input
              label="DA"
              type="number"
              value={salDa}
              onChange={(e) => setSalDa(e.target.value)}
            />
          </div>
          <p className="text-xs text-secondary">
            Salary figures are encrypted at rest and never cached or logged.
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setSalaryModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => salaryMutation.mutate()}
              loading={salaryMutation.isPending}
              disabled={!salEmployeeId || !salCtc || !salBasic || !salGross}
            >
              Save
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
