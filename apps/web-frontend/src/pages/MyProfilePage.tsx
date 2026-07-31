import { useQuery } from '@tanstack/react-query';
import { meApi } from '../api/endpoints.js';
import { ApiError } from '../api/client.js';
import ERPPageHeader from '../components/erp/ERPPageHeader.js';
import ERPErrorBoundary from '../components/erp/ERPErrorBoundary.js';
import ERPFormSection from '../components/erp/ERPFormSection.js';
import ERPEmptyState from '../components/erp/ERPEmptyState.js';
import { ERPCardSkeleton } from '../components/erp/ERPSkeleton.js';
import Badge from '../components/ui/Badge.js';
import { formatCurrency, formatDate } from '../lib/format.js';

interface AttendanceRow {
  attendanceDate: string;
  status: string;
  workHours: string;
  overtimeHours: string;
}

interface LeaveBalanceRow {
  leaveTypeId: number;
  totalDays: string;
  usedDays: string;
  pendingDays: string;
  carriedForwardDays: string;
}

interface PayslipRow {
  id: number;
  periodMonth: number;
  periodYear: number;
  status: string;
  grossSalary: number;
  netSalary: number;
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

function isNotLinked(err: unknown): boolean {
  return err instanceof ApiError && err.statusCode === 404;
}

export default function MyProfilePage() {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const attendanceQuery = useQuery({
    queryKey: ['me-attendance', currentMonth],
    queryFn: () => meApi.attendance(currentMonth),
    retry: false,
  });
  const leaveQuery = useQuery({
    queryKey: ['me-leave-balance'],
    queryFn: () => meApi.leaveBalance(),
    retry: false,
  });
  const payslipQuery = useQuery({
    queryKey: ['me-payroll-slips'],
    queryFn: () => meApi.payrollSlips(),
    retry: false,
  });

  const notLinked =
    isNotLinked(attendanceQuery.error) ||
    isNotLinked(leaveQuery.error) ||
    isNotLinked(payslipQuery.error);

  const attendance: AttendanceRow[] =
    ((attendanceQuery.data as Record<string, unknown>)?.content as AttendanceRow[]) ?? [];
  const balances: LeaveBalanceRow[] =
    ((leaveQuery.data as Record<string, unknown>)?.content as LeaveBalanceRow[]) ?? [];
  const payslips: PayslipRow[] =
    ((payslipQuery.data as Record<string, unknown>)?.content as PayslipRow[]) ?? [];

  return (
    <ERPErrorBoundary>
      <div>
        <ERPPageHeader
          variant="list"
          title="My Profile"
          subtitle="Your own attendance, leave balance, and payslips."
        />

        {notLinked ? (
          <ERPEmptyState
            type="no-data"
            title="Your login isn't linked to an employee record yet"
            description="Ask HR to set the 'Linked User Account' field on your employee profile to enable self-service."
          />
        ) : (
          <div className="space-y-6 mt-6">
            <ERPFormSection
              title={`This Month's Attendance — ${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`}
              columns={1}
            >
              {attendanceQuery.isLoading ? (
                <ERPCardSkeleton />
              ) : attendance.length === 0 ? (
                <p className="text-sm text-secondary">No attendance marked yet this month.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-secondary text-xs uppercase">
                      <th className="py-2">Date</th>
                      <th className="py-2">Status</th>
                      <th className="py-2 text-right">Work Hours</th>
                      <th className="py-2 text-right">Overtime</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-default">
                    {attendance.map((a) => (
                      <tr key={a.attendanceDate}>
                        <td className="py-2">{formatDate(a.attendanceDate)}</td>
                        <td className="py-2">
                          <Badge
                            variant={
                              a.status === 'PRESENT'
                                ? 'success'
                                : a.status === 'ABSENT'
                                  ? 'danger'
                                  : 'default'
                            }
                          >
                            {a.status}
                          </Badge>
                        </td>
                        <td className="py-2 text-right">{a.workHours}</td>
                        <td className="py-2 text-right">{a.overtimeHours}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </ERPFormSection>

            <ERPFormSection title="My Leave Balance" columns={1}>
              {leaveQuery.isLoading ? (
                <ERPCardSkeleton />
              ) : balances.length === 0 ? (
                <p className="text-sm text-secondary">No leave balance on file yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-secondary text-xs uppercase">
                      <th className="py-2">Leave Type</th>
                      <th className="py-2 text-right">Total</th>
                      <th className="py-2 text-right">Used</th>
                      <th className="py-2 text-right">Available</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-default">
                    {balances.map((b) => {
                      const available =
                        parseFloat(b.totalDays) +
                        parseFloat(b.carriedForwardDays) -
                        parseFloat(b.usedDays) -
                        parseFloat(b.pendingDays);
                      return (
                        <tr key={b.leaveTypeId}>
                          <td className="py-2">Leave Type #{b.leaveTypeId}</td>
                          <td className="py-2 text-right">{b.totalDays}</td>
                          <td className="py-2 text-right">{b.usedDays}</td>
                          <td className="py-2 text-right font-semibold">{available}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </ERPFormSection>

            <ERPFormSection title="My Payslips" columns={1}>
              {payslipQuery.isLoading ? (
                <ERPCardSkeleton />
              ) : payslips.length === 0 ? (
                <p className="text-sm text-secondary">No payslips available yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-secondary text-xs uppercase">
                      <th className="py-2">Period</th>
                      <th className="py-2 text-right">Gross</th>
                      <th className="py-2 text-right">Net</th>
                      <th className="py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-default">
                    {payslips.map((p) => (
                      <tr key={p.id}>
                        <td className="py-2">
                          {MONTH_NAMES[p.periodMonth - 1]} {p.periodYear}
                        </td>
                        <td className="py-2 text-right">{formatCurrency(p.grossSalary)}</td>
                        <td className="py-2 text-right font-semibold">
                          {formatCurrency(p.netSalary)}
                        </td>
                        <td className="py-2">
                          <Badge variant={p.status === 'PAID' ? 'success' : 'default'}>
                            {p.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </ERPFormSection>
          </div>
        )}
      </div>
    </ERPErrorBoundary>
  );
}
