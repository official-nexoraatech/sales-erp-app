import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { employeeApi, leaveApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import Badge from '../../components/ui/Badge.js';
import Button from '../../components/ui/Button.js';
import Modal from '../../components/ui/Modal.js';
import Input from '../../components/ui/Input.js';
import { formatDate } from '../../lib/format.js';

interface Employee {
  id: number;
  employeeCode: string;
  displayName: string;
  phone: string;
  email?: string;
  gender?: string;
  employmentType: string;
  joiningDate: string;
  exitDate?: string;
  status: string;
  hasSalaryData: boolean;
}

interface LeaveBalance {
  leaveTypeId: number;
  totalDays: string;
  usedDays: string;
  pendingDays: string;
  carriedForwardDays: string;
}

export default function EmployeeViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [exitModalOpen, setExitModalOpen] = useState(false);
  const [exitDate, setExitDate] = useState('');
  const [exitReason, setExitReason] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['employees', id],
    queryFn: () => employeeApi.getById(Number(id)),
  });
  const employee = ((data as Record<string, unknown>)?.data as Employee) ?? (data as unknown as Employee);

  const { data: balanceData } = useQuery({
    queryKey: ['leave-balance', id],
    queryFn: () => leaveApi.balance(Number(id)),
  });
  const balances: LeaveBalance[] = ((balanceData as Record<string, unknown>)?.content as LeaveBalance[]) ?? [];

  const exitMutation = useMutation({
    mutationFn: () => employeeApi.exit(Number(id), { exitDate, exitReason }),
    onSuccess: () => {
      toast.success('Employee exit recorded');
      qc.invalidateQueries({ queryKey: ['employees'] });
      setExitModalOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !employee) return <div className="p-8 text-center text-secondary">Loading…</div>;

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title={employee.displayName}
        subtitle={employee.employeeCode}
        backTo="/hr/employees"
        status={employee.status}
        statusVariant={employee.status === 'ACTIVE' ? 'success' : 'default'}
        actions={
          <div className="flex gap-2">
            {hasPermission(PERMISSIONS.EMPLOYEE_UPDATE) && (
              <Button variant="secondary" onClick={() => navigate(`/hr/employees/${id}/edit`)}>Edit</Button>
            )}
            {hasPermission(PERMISSIONS.EMPLOYEE_UPDATE) && employee.status === 'ACTIVE' && (
              <Button variant="danger-outline" onClick={() => setExitModalOpen(true)}>Record Exit</Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-6 mt-6">
        <div className="bg-surface-card rounded-xl border border-default p-5">
          <h3 className="font-semibold text-primary mb-4">Profile</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-secondary">Phone</dt><dd>{employee.phone}</dd></div>
            <div className="flex justify-between"><dt className="text-secondary">Email</dt><dd>{employee.email ?? '–'}</dd></div>
            <div className="flex justify-between"><dt className="text-secondary">Gender</dt><dd>{employee.gender ?? '–'}</dd></div>
            <div className="flex justify-between"><dt className="text-secondary">Employment Type</dt><dd><Badge variant="outline">{employee.employmentType}</Badge></dd></div>
            <div className="flex justify-between"><dt className="text-secondary">Joining Date</dt><dd>{formatDate(employee.joiningDate)}</dd></div>
            {employee.exitDate && <div className="flex justify-between"><dt className="text-secondary">Exit Date</dt><dd>{formatDate(employee.exitDate)}</dd></div>}
          </dl>
        </div>

        <div className="bg-surface-card rounded-xl border border-default p-5">
          <h3 className="font-semibold text-primary mb-4">Salary</h3>
          {employee.hasSalaryData ? (
            <div className="text-sm text-secondary">
              <p>Salary data is encrypted. View on Payroll → Employee Salary page.</p>
              {hasPermission(PERMISSIONS.PAYROLL_PROCESS) && (
                <Button size="sm" variant="secondary" className="mt-3" onClick={() => navigate(`/hr/payroll?employeeId=${id}`)}>
                  Manage Salary
                </Button>
              )}
            </div>
          ) : (
            <p className="text-sm text-disabled">You do not have permission to view salary information.</p>
          )}
        </div>

        <div className="bg-surface-card rounded-xl border border-default p-5 col-span-2">
          <h3 className="font-semibold text-primary mb-4">Leave Balance</h3>
          {balances.length === 0 ? (
            <p className="text-sm text-disabled">No leave balance records yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-secondary text-xs uppercase">
                  <th className="py-2">Leave Type</th>
                  <th className="py-2 text-right">Total</th>
                  <th className="py-2 text-right">Used</th>
                  <th className="py-2 text-right">Pending</th>
                  <th className="py-2 text-right">Carried Forward</th>
                  <th className="py-2 text-right">Available</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-default">
                {balances.map((b) => {
                  const available = parseFloat(b.totalDays) + parseFloat(b.carriedForwardDays) - parseFloat(b.usedDays) - parseFloat(b.pendingDays);
                  return (
                    <tr key={b.leaveTypeId}>
                      <td className="py-2">Leave Type #{b.leaveTypeId}</td>
                      <td className="py-2 text-right">{b.totalDays}</td>
                      <td className="py-2 text-right">{b.usedDays}</td>
                      <td className="py-2 text-right">{b.pendingDays}</td>
                      <td className="py-2 text-right">{b.carriedForwardDays}</td>
                      <td className="py-2 text-right font-semibold">{available}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Modal open={exitModalOpen} onClose={() => setExitModalOpen(false)} title="Record Employee Exit" size="sm">
        <div className="space-y-4">
          <Input label="Exit Date" type="date" required value={exitDate} onChange={(e) => setExitDate(e.target.value)} />
          <Input label="Exit Reason" required value={exitReason} onChange={(e) => setExitReason(e.target.value)} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setExitModalOpen(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => exitMutation.mutate()} loading={exitMutation.isPending} disabled={!exitDate || !exitReason}>
              Confirm Exit
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
