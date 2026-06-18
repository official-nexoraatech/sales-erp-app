import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CalendarCheck, ClipboardList, Edit } from 'lucide-react';
import toast from 'react-hot-toast';
import { staffApi } from '../../api/endpoints';
import type { AttendanceRequest, AttendanceStatus } from '../../api/endpoints';
import { queryClient } from '../../app/queryClient';
import { Button } from '../../components/ui/Button';
import { Loader } from '../../components/ui/Loader';
import { attendanceStatuses, inputClass, labelClass, pretty, statusClass, textareaClass } from './staffShared';

const today = new Date().toISOString().slice(0, 10);

const emptyAttendance: AttendanceRequest = {
  employeeId: 0,
  date: today,
  checkIn: '09:30',
  checkOut: '18:30',
  status: 'PRESENT',
  note: '',
};

export const StaffAttendancePage: React.FC = () => {
  const [filters, setFilters] = useState({ date: today, department: '', employee: '', status: '' });
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<AttendanceRequest>(emptyAttendance);

  const attendance = useQuery({
    queryKey: ['staff-attendance', filters],
    queryFn: () => staffApi.getAttendance(filters),
  });
  const summaryMonth = filters.date ? new Date(filters.date).getMonth() + 1 : new Date().getMonth() + 1;
  const summaryYear = filters.date ? new Date(filters.date).getFullYear() : new Date().getFullYear();
  const summary = useQuery({
    queryKey: ['staff-attendance-summary', summaryMonth, summaryYear],
    queryFn: () => staffApi.getAttendanceSummary({ month: summaryMonth, year: summaryYear }),
  });
  const employees = useQuery({ queryKey: ['staff-employees-options'], queryFn: () => staffApi.getEmployees({ page: 0, size: 100 }) });
  const departments = useQuery({ queryKey: ['staff-departments-options'], queryFn: staffApi.getDepartments });

  const mark = useMutation({
    mutationFn: () => staffApi.markAttendance(form),
    onSuccess: () => {
      toast.success('Attendance marked');
      setModalOpen(false);
      setForm(emptyAttendance);
      queryClient.invalidateQueries({ queryKey: ['staff-attendance'] });
      queryClient.invalidateQueries({ queryKey: ['staff-attendance-summary'] });
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to mark attendance'),
  });

  const setFilter = (field: keyof typeof filters, value: string) => setFilters((current) => ({ ...current, [field]: value }));
  const set = (field: keyof AttendanceRequest, value: string | number) => setForm((current) => ({ ...current, [field]: value }));
  const submit = () => {
    if (!form.employeeId) return toast.error('Employee is required');
    if (!form.date) return toast.error('Date is required');
    mark.mutate();
  };

  const summaryRows = summary.data?.data || [];

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Staff Management &gt; Attendance</div>
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
          <h1 className="text-xl font-semibold text-gray-900">Attendance</h1>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => setModalOpen(true)}><CalendarCheck size={16} /> Mark Attendance</Button>
            <Button type="button" variant="secondary"><ClipboardList size={16} /> Bulk Mark</Button>
            <Button type="button" variant="outline">Export</Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 p-5 md:grid-cols-4">
          {['PRESENT', 'ABSENT', 'LEAVE', 'LATE'].map((status) => (
            <div key={status} className="rounded border bg-gray-50 p-4">
              <p className="text-sm text-gray-500">{pretty(status)}</p>
              <p className="text-2xl font-bold text-gray-900">{summaryRows.find((entry) => entry.status === status)?.count || 0}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 border-t p-5 md:grid-cols-4">
          <label className={labelClass}>Date<input type="date" className={`${inputClass} mt-1`} value={filters.date} onChange={(event) => setFilter('date', event.target.value)} /></label>
          <label className={labelClass}>Department<select className={`${inputClass} mt-1`} value={filters.department} onChange={(event) => setFilter('department', event.target.value)}><option value="">All departments</option>{(departments.data?.data || []).map((entry) => <option key={entry.id} value={entry.name}>{entry.name}</option>)}</select></label>
          <label className={labelClass}>Employee<input className={`${inputClass} mt-1`} value={filters.employee} onChange={(event) => setFilter('employee', event.target.value)} placeholder="Search employee" /></label>
          <label className={labelClass}>Status<select className={`${inputClass} mt-1`} value={filters.status} onChange={(event) => setFilter('status', event.target.value)}><option value="">All status</option>{attendanceStatuses.map((entry) => <option key={entry} value={entry}>{pretty(entry)}</option>)}</select></label>
        </div>

        <div className="overflow-x-auto px-3 pb-3">
          {attendance.isLoading ? <div className="p-10"><Loader /></div> : (
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-gray-50">
                <tr>{['Date', 'Employee Code', 'Employee Name', 'Check In', 'Check Out', 'Total Hours', 'Status', 'Action'].map((heading) => <th key={heading} className="border p-3 text-left">{heading}</th>)}</tr>
              </thead>
              <tbody>
                {(attendance.data?.data || []).length ? attendance.data?.data.map((row) => (
                  <tr key={row.id} className="border-b even:bg-gray-50">
                    <td className="border p-3">{row.date}</td>
                    <td className="border p-3 font-semibold">{row.employeeCode}</td>
                    <td className="border p-3">{row.employeeName}</td>
                    <td className="border p-3">{row.checkIn || '-'}</td>
                    <td className="border p-3">{row.checkOut || '-'}</td>
                    <td className="border p-3">{row.totalHours.toFixed(2)}</td>
                    <td className="border p-3"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClass(row.status)}`}>{pretty(row.status)}</span></td>
                    <td className="border p-3"><button type="button" onClick={() => { setForm({ employeeId: row.employeeId, date: row.date, checkIn: row.checkIn, checkOut: row.checkOut, status: row.status, note: row.note }); setModalOpen(true); }} className="text-orange-600"><Edit size={16} /></button></td>
                  </tr>
                )) : <tr><td colSpan={8} className="bg-gray-50 p-5 text-center">No attendance records found</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-xl">
            <div className="border-b px-5 py-4"><h2 className="text-lg font-semibold">Mark Attendance</h2></div>
            <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
              <label className={labelClass}>Employee<select className={`${inputClass} mt-1`} value={form.employeeId} onChange={(event) => set('employeeId', Number(event.target.value))}><option value={0}>Select employee</option>{(employees.data?.data?.content || []).map((employee) => <option key={employee.id} value={employee.id}>{employee.employeeCode} / {employee.firstName} {employee.lastName}</option>)}</select></label>
              <label className={labelClass}>Date<input type="date" className={`${inputClass} mt-1`} value={form.date} onChange={(event) => set('date', event.target.value)} /></label>
              <label className={labelClass}>Check In<input type="time" className={`${inputClass} mt-1`} value={form.checkIn} onChange={(event) => set('checkIn', event.target.value)} /></label>
              <label className={labelClass}>Check Out<input type="time" className={`${inputClass} mt-1`} value={form.checkOut} onChange={(event) => set('checkOut', event.target.value)} /></label>
              <label className={labelClass}>Status<select className={`${inputClass} mt-1`} value={form.status} onChange={(event) => set('status', event.target.value as AttendanceStatus)}>{attendanceStatuses.map((entry) => <option key={entry} value={entry}>{pretty(entry)}</option>)}</select></label>
              <label className={`${labelClass} md:col-span-2`}>Note<textarea className={textareaClass} value={form.note} onChange={(event) => set('note', event.target.value)} /></label>
            </div>
            <div className="flex justify-end gap-3 border-t bg-gray-50 p-5">
              <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Close</Button>
              <Button type="button" isLoading={mark.isPending} onClick={submit}>Submit</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
