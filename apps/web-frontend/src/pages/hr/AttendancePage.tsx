import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { attendanceApi, employeeApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPTabs from '../../components/erp/ERPTabs.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import Button from '../../components/ui/Button.js';
import Select from '../../components/ui/Select.js';
import Input from '../../components/ui/Input.js';
import Badge from '../../components/ui/Badge.js';
import { formatDate } from '../../lib/format.js';

interface Employee { id: number; displayName: string; employeeCode: string; }
interface AttendanceRecord { id: number; employeeId: number; attendanceDate: string; status: string; workHours: string; isLate: boolean; }

const STATUS_VARIANT: Record<string, 'success' | 'danger' | 'warning' | 'info' | 'default'> = {
  PRESENT: 'success',
  ABSENT: 'danger',
  HALF_DAY: 'warning',
  LATE: 'warning',
  LEAVE: 'info',
  HOLIDAY: 'default',
  WEEKLY_OFF: 'default',
};

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function AttendancePage() {
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canMark = hasPermission(PERMISSIONS.ATTENDANCE_MARK);
  const canViewReport = hasPermission(PERMISSIONS.ATTENDANCE_REPORT);
  const availableTabs = (['mark', 'calendar', 'summary'] as const).filter(
    (t) => (t === 'mark' ? canMark : t === 'summary' ? canViewReport : true)
  );
  const [tab, setTab] = useState<'mark' | 'calendar' | 'summary'>(canMark ? 'mark' : 'calendar');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState('PRESENT');
  const [month, setMonth] = useState(currentMonth());

  const { data: empData } = useQuery({ queryKey: ['employees-all'], queryFn: () => employeeApi.list(), enabled: hasPermission(PERMISSIONS.EMPLOYEE_VIEW) });
  const employees: Employee[] = ((empData as Record<string, unknown>)?.content as Employee[]) ?? [];

  const markMutation = useMutation({
    mutationFn: () => attendanceApi.mark({ employeeId: Number(selectedEmployeeId), attendanceDate: date, status }),
    onSuccess: () => { toast.success('Attendance marked'); qc.invalidateQueries({ queryKey: ['attendance'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: calData, isLoading: calLoading } = useQuery({
    queryKey: ['attendance', selectedEmployeeId, month],
    queryFn: () => attendanceApi.getForEmployee(Number(selectedEmployeeId), month),
    enabled: tab === 'calendar' && !!selectedEmployeeId,
  });
  const records: AttendanceRecord[] = ((calData as Record<string, unknown>)?.content as AttendanceRecord[]) ?? [];

  const { data: summaryData, isLoading: summaryLoading } = useQuery({
    queryKey: ['attendance-summary', month],
    queryFn: () => attendanceApi.teamSummary(month),
    enabled: tab === 'summary' && canViewReport,
  });
  const summary = (summaryData as Record<string, unknown>)?.summary as
    Record<string, { presentDays: number; absentDays: number; lopDays: number; lateDays: number }> ?? {};

  return (
    <div>
      <ERPPageHeader variant="list" title="Attendance" subtitle="Mark attendance, view calendars, and team summaries." />

      <ERPTabs
        className="mb-5"
        tabs={availableTabs.map((t) => ({ key: t, label: t[0]!.toUpperCase() + t.slice(1) }))}
        active={tab}
        onChange={(key) => setTab(key as typeof tab)}
      />

      {tab === 'mark' && (
        <div className="max-w-xl space-y-4 bg-surface-card rounded-xl border border-default p-5">
          <Select label="Employee" value={selectedEmployeeId} onChange={(e) => setSelectedEmployeeId(e.target.value)}>
            <option value="">Select employee…</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.displayName} ({e.employeeCode})</option>)}
          </Select>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="PRESENT">Present</option>
              <option value="ABSENT">Absent</option>
              <option value="HALF_DAY">Half Day</option>
              <option value="LATE">Late</option>
              <option value="HOLIDAY">Holiday</option>
              <option value="WEEKLY_OFF">Weekly Off</option>
            </Select>
          </div>
          <Button onClick={() => markMutation.mutate()} loading={markMutation.isPending} disabled={!selectedEmployeeId}>
            Mark Attendance
          </Button>
        </div>
      )}

      {tab === 'calendar' && (
        <div className="space-y-4">
          <div className="flex gap-3">
            <Select value={selectedEmployeeId} onChange={(e) => setSelectedEmployeeId(e.target.value)} className="max-w-xs">
              <option value="">Select employee…</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.displayName}</option>)}
            </Select>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="max-w-[160px]" />
          </div>
          {!selectedEmployeeId ? (
            <p className="text-secondary text-sm">Select an employee to view their attendance calendar.</p>
          ) : calLoading ? (
            <p className="text-secondary text-sm">Loading…</p>
          ) : (
            <div className="grid grid-cols-7 gap-2">
              {records.map((r) => (
                <div key={r.id} className="border border-default rounded-lg p-2 text-xs">
                  <p className="text-secondary">{formatDate(r.attendanceDate)}</p>
                  <Badge variant={STATUS_VARIANT[r.status] ?? 'default'}>{r.status}</Badge>
                  <p className="text-disabled mt-1">{r.workHours}h</p>
                </div>
              ))}
              {records.length === 0 && <p className="col-span-7 text-disabled text-sm">No attendance records for this month.</p>}
            </div>
          )}
        </div>
      )}

      {tab === 'summary' && (
        <div className="space-y-4">
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="max-w-[160px]" />
          {summaryLoading ? (
            <ERPTableSkeleton rows={5} cols={5} />
          ) : (
            <table className="w-full text-sm bg-surface-card rounded-xl border border-default overflow-hidden">
              <thead className="bg-surface-subtle">
                <tr className="text-left text-xs uppercase text-secondary">
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3 text-right">Present Days</th>
                  <th className="px-4 py-3 text-right">Absent Days</th>
                  <th className="px-4 py-3 text-right">LOP Days</th>
                  <th className="px-4 py-3 text-right">Late Days</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-default">
                {Object.entries(summary).map(([empId, s]) => {
                  const emp = employees.find((e) => e.id === Number(empId));
                  return (
                    <tr key={empId}>
                      <td className="px-4 py-3">{emp?.displayName ?? `Employee #${empId}`}</td>
                      <td className="px-4 py-3 text-right">{s.presentDays}</td>
                      <td className="px-4 py-3 text-right">{s.absentDays}</td>
                      <td className="px-4 py-3 text-right">{s.lopDays}</td>
                      <td className="px-4 py-3 text-right">{s.lateDays}</td>
                    </tr>
                  );
                })}
                {Object.keys(summary).length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-disabled">No attendance data for this month.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
