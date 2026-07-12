import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { leaveApi, employeeApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Select from '../../components/ui/Select.js';
import Input from '../../components/ui/Input.js';
import Badge from '../../components/ui/Badge.js';
import { formatDate } from '../../lib/format.js';

interface Employee {
  id: number;
  displayName: string;
}
interface LeaveType {
  id: number;
  name: string;
  daysPerYear: string;
}
interface LeaveApplication {
  id: number;
  employeeId: number;
  leaveTypeId: number;
  startDate: string;
  endDate: string;
  days: string;
  status: string;
  reason?: string;
}

const STATUS_VARIANT: Record<string, 'success' | 'danger' | 'warning' | 'default'> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'default',
};

export default function LeavesPage() {
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [employeeId, setEmployeeId] = useState('');
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');

  const { data: empData } = useQuery({
    queryKey: ['employees-all'],
    queryFn: () => employeeApi.list(),
    enabled: hasPermission(PERMISSIONS.EMPLOYEE_VIEW),
  });
  const employees: Employee[] = ((empData as Record<string, unknown>)?.content as Employee[]) ?? [];

  const { data: typeData } = useQuery({
    queryKey: ['leave-types'],
    queryFn: () => leaveApi.types(),
  });
  const leaveTypes: LeaveType[] =
    ((typeData as Record<string, unknown>)?.content as LeaveType[]) ?? [];

  const seedMutation = useMutation({
    mutationFn: () => leaveApi.seedTypes(),
    onSuccess: () => {
      toast.success('Default leave types seeded');
      qc.invalidateQueries({ queryKey: ['leave-types'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: pendingData, isLoading: pendingLoading } = useQuery({
    queryKey: ['leave-pending'],
    queryFn: () => leaveApi.pendingApprovals(),
    enabled: hasPermission(PERMISSIONS.LEAVE_APPROVE),
  });
  const pending: LeaveApplication[] =
    ((pendingData as Record<string, unknown>)?.content as LeaveApplication[]) ?? [];

  const applyMutation = useMutation({
    mutationFn: () =>
      leaveApi.apply({
        employeeId: Number(employeeId),
        leaveTypeId: Number(leaveTypeId),
        startDate,
        endDate,
        reason,
      }),
    onSuccess: () => {
      toast.success('Leave application submitted');
      setStartDate('');
      setEndDate('');
      setReason('');
      qc.invalidateQueries({ queryKey: ['leave-pending'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => leaveApi.approve(id),
    onSuccess: () => {
      toast.success('Leave approved');
      qc.invalidateQueries({ queryKey: ['leave-pending'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: number) => leaveApi.reject(id, { rejectionReason: 'Rejected by manager' }),
    onSuccess: () => {
      toast.success('Leave rejected');
      qc.invalidateQueries({ queryKey: ['leave-pending'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const empName = (id: number) => employees.find((e) => e.id === id)?.displayName ?? `#${id}`;
  const typeName = (id: number) => leaveTypes.find((t) => t.id === id)?.name ?? `#${id}`;

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Leave Management"
        subtitle="Apply for leave and manage team approvals."
        actions={
          leaveTypes.length === 0 && hasPermission(PERMISSIONS.LEAVE_APPROVE) ? (
            <Button
              variant="secondary"
              onClick={() => seedMutation.mutate()}
              loading={seedMutation.isPending}
            >
              Seed Default Leave Types
            </Button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-surface-card rounded-xl border border-default p-5 space-y-4">
          <h3 className="font-semibold text-primary">Apply for Leave</h3>
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
          <Select
            label="Leave Type"
            value={leaveTypeId}
            onChange={(e) => setLeaveTypeId(e.target.value)}
          >
            <option value="">Select leave type…</option>
            {leaveTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.daysPerYear} days/yr)
              </option>
            ))}
          </Select>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Start Date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <Input
              label="End Date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button
            onClick={() => applyMutation.mutate()}
            loading={applyMutation.isPending}
            disabled={!employeeId || !leaveTypeId || !startDate || !endDate}
          >
            Submit Application
          </Button>
        </div>

        {hasPermission(PERMISSIONS.LEAVE_APPROVE) && (
          <div className="bg-surface-card rounded-xl border border-default p-5">
            <h3 className="font-semibold text-primary mb-4">Pending Approvals</h3>
            {pendingLoading ? (
              <p className="text-secondary text-sm">Loading…</p>
            ) : pending.length === 0 ? (
              <ERPEmptyState
                type="no-data"
                title="No pending leave applications"
                description="Leave requests awaiting approval will appear here."
              />
            ) : (
              <ul className="space-y-3">
                {pending.map((app) => (
                  <li key={app.id} className="border border-default rounded-lg p-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-medium text-primary">{empName(app.employeeId)}</p>
                        <p className="text-xs text-secondary">
                          {typeName(app.leaveTypeId)} — {app.days} day(s)
                        </p>
                        <p className="text-xs text-disabled">
                          {formatDate(app.startDate)} – {formatDate(app.endDate)}
                        </p>
                      </div>
                      <Badge variant={STATUS_VARIANT[app.status] ?? 'default'}>{app.status}</Badge>
                    </div>
                    <div className="flex gap-2 mt-3">
                      <Button
                        size="sm"
                        onClick={() => approveMutation.mutate(app.id)}
                        loading={approveMutation.isPending}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="danger-outline"
                        onClick={() => rejectMutation.mutate(app.id)}
                        loading={rejectMutation.isPending}
                      >
                        Reject
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
