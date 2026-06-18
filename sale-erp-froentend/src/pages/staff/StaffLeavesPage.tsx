import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Eye, FileUp, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { staffApi } from '../../api/endpoints';
import type { LeaveRequestItem, LeaveRequestPayload, LeaveStatus } from '../../api/endpoints';
import { queryClient } from '../../app/queryClient';
import { Button } from '../../components/ui/Button';
import { Loader } from '../../components/ui/Loader';
import { inputClass, labelClass, leaveStatuses, pretty, statusClass, textareaClass } from './staffShared';

const today = new Date().toISOString().slice(0, 10);
const emptyLeave: LeaveRequestPayload = { employeeId: 0, leaveType: '', fromDate: today, toDate: today, reason: '' };

export const StaffLeavesPage: React.FC = () => {
  const [filters, setFilters] = useState({ employee: '', leaveType: '', status: '', fromDate: '', toDate: '' });
  const [modalOpen, setModalOpen] = useState(false);
  const [viewLeave, setViewLeave] = useState<LeaveRequestItem | null>(null);
  const [form, setForm] = useState<LeaveRequestPayload>(emptyLeave);

  const leaves = useQuery({ queryKey: ['staff-leaves', filters], queryFn: () => staffApi.getLeaves(filters) });
  const employees = useQuery({ queryKey: ['staff-employees-options'], queryFn: () => staffApi.getEmployees({ page: 0, size: 100 }) });
  const leaveTypes = useQuery({ queryKey: ['staff-leave-types'], queryFn: () => staffApi.getSettings('leaveTypes') });
  const balances = useQuery({ queryKey: ['staff-leave-balances'], queryFn: () => staffApi.getLeaveBalances() });

  const create = useMutation({
    mutationFn: () => staffApi.createLeave(form),
    onSuccess: () => {
      toast.success('Leave request created');
      setModalOpen(false);
      setForm(emptyLeave);
      queryClient.invalidateQueries({ queryKey: ['staff-leaves'] });
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to create leave request'),
  });
  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: LeaveStatus }) => staffApi.updateLeaveStatus(id, status),
    onSuccess: () => {
      toast.success('Leave status updated');
      queryClient.invalidateQueries({ queryKey: ['staff-leaves'] });
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to update leave'),
  });

  const setFilter = (field: keyof typeof filters, value: string) => setFilters((current) => ({ ...current, [field]: value }));
  const set = (field: keyof LeaveRequestPayload, value: string | number) => setForm((current) => ({ ...current, [field]: value }));
  const submit = () => {
    if (!form.employeeId) return toast.error('Employee is required');
    if (!form.leaveType) return toast.error('Leave type is required');
    if (!form.reason.trim()) return toast.error('Reason is required');
    create.mutate();
  };

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Staff Management &gt; Leave Management</div>
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
          <h1 className="text-xl font-semibold text-gray-900">Leave Management</h1>
          <Button type="button" onClick={() => setModalOpen(true)}>Create Leave Request</Button>
        </div>

        <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-5">
          <label className={labelClass}>Employee<input className={`${inputClass} mt-1`} value={filters.employee} onChange={(event) => setFilter('employee', event.target.value)} placeholder="Search employee" /></label>
          <label className={labelClass}>Leave Type<select className={`${inputClass} mt-1`} value={filters.leaveType} onChange={(event) => setFilter('leaveType', event.target.value)}><option value="">All types</option>{(leaveTypes.data?.data || []).map((entry) => <option key={entry.id} value={entry.name}>{entry.name}</option>)}</select></label>
          <label className={labelClass}>Status<select className={`${inputClass} mt-1`} value={filters.status} onChange={(event) => setFilter('status', event.target.value)}><option value="">All status</option>{leaveStatuses.map((entry) => <option key={entry} value={entry}>{pretty(entry)}</option>)}</select></label>
          <label className={labelClass}>From Date<input type="date" className={`${inputClass} mt-1`} value={filters.fromDate} onChange={(event) => setFilter('fromDate', event.target.value)} /></label>
          <label className={labelClass}>To Date<input type="date" className={`${inputClass} mt-1`} value={filters.toDate} onChange={(event) => setFilter('toDate', event.target.value)} /></label>
        </div>

        <div className="overflow-x-auto px-3 pb-3">
          {leaves.isLoading ? <div className="p-10"><Loader /></div> : (
            <table className="w-full min-w-[1060px] text-sm">
              <thead className="bg-gray-50">
                <tr>{['Employee', 'Leave Type', 'From Date', 'To Date', 'Days', 'Reason', 'Status', 'Action'].map((heading) => <th key={heading} className="border p-3 text-left">{heading}</th>)}</tr>
              </thead>
              <tbody>
                {(leaves.data?.data || []).length ? leaves.data?.data.map((leave) => (
                  <tr key={leave.id} className="border-b even:bg-gray-50">
                    <td className="border p-3">{leave.employeeName}</td>
                    <td className="border p-3">{leave.leaveType}</td>
                    <td className="border p-3">{leave.fromDate}</td>
                    <td className="border p-3">{leave.toDate}</td>
                    <td className="border p-3">{leave.days}</td>
                    <td className="border p-3">{leave.reason}</td>
                    <td className="border p-3"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClass(leave.status)}`}>{pretty(leave.status)}</span></td>
                    <td className="border p-3">
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setViewLeave(leave)} className="text-blue-600"><Eye size={16} /></button>
                        <button type="button" onClick={() => updateStatus.mutate({ id: leave.id, status: 'APPROVED' })} className="text-green-600"><Check size={16} /></button>
                        <button type="button" onClick={() => updateStatus.mutate({ id: leave.id, status: 'REJECTED' })} className="text-red-600"><X size={16} /></button>
                      </div>
                    </td>
                  </tr>
                )) : <tr><td colSpan={8} className="bg-gray-50 p-5 text-center">No leave requests found</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="border-b px-5 py-4"><h2 className="text-lg font-semibold">Leave Balance</h2></div>
        <div className="overflow-x-auto p-3">
          <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr>{['Leave Type', 'Allotted', 'Used', 'Remaining'].map((heading) => <th key={heading} className="border p-3 text-left">{heading}</th>)}</tr></thead>
            <tbody>{(balances.data?.data || []).map((balance) => <tr key={balance.leaveType} className="border-b even:bg-gray-50"><td className="border p-3 font-semibold">{balance.leaveType}</td><td className="border p-3">{balance.allotted}</td><td className="border p-3">{balance.used}</td><td className="border p-3">{balance.remaining}</td></tr>)}</tbody>
          </table>
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-xl">
            <div className="border-b px-5 py-4"><h2 className="text-lg font-semibold">Create Leave Request</h2></div>
            <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
              <label className={labelClass}>Employee<select className={`${inputClass} mt-1`} value={form.employeeId} onChange={(event) => set('employeeId', Number(event.target.value))}><option value={0}>Select employee</option>{(employees.data?.data?.content || []).map((employee) => <option key={employee.id} value={employee.id}>{employee.employeeCode} / {employee.firstName} {employee.lastName}</option>)}</select></label>
              <label className={labelClass}>Leave Type<select className={`${inputClass} mt-1`} value={form.leaveType} onChange={(event) => set('leaveType', event.target.value)}><option value="">Select leave type</option>{(leaveTypes.data?.data || []).map((entry) => <option key={entry.id} value={entry.name}>{entry.name}</option>)}</select></label>
              <label className={labelClass}>From Date<input type="date" className={`${inputClass} mt-1`} value={form.fromDate} onChange={(event) => set('fromDate', event.target.value)} /></label>
              <label className={labelClass}>To Date<input type="date" className={`${inputClass} mt-1`} value={form.toDate} onChange={(event) => set('toDate', event.target.value)} /></label>
              <label className={`${labelClass} md:col-span-2`}>Reason<textarea className={textareaClass} value={form.reason} onChange={(event) => set('reason', event.target.value)} /></label>
              <div className="md:col-span-2 rounded border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600"><FileUp className="mb-2 text-blue-500" size={20} /> Attachment placeholder for medical proof or supporting documents.</div>
            </div>
            <div className="flex justify-end gap-3 border-t bg-gray-50 p-5">
              <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Close</Button>
              <Button type="button" isLoading={create.isPending} onClick={submit}>Submit</Button>
            </div>
          </div>
        </div>
      )}

      {viewLeave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-lg overflow-hidden rounded-lg bg-white shadow-xl">
            <div className="border-b px-5 py-4"><h2 className="text-lg font-semibold">Leave Request</h2></div>
            <div className="grid grid-cols-1 gap-4 p-5 text-sm md:grid-cols-2">
              <div><p className="text-gray-500">Employee</p><p className="font-semibold">{viewLeave.employeeName}</p></div>
              <div><p className="text-gray-500">Leave Type</p><p className="font-semibold">{viewLeave.leaveType}</p></div>
              <div><p className="text-gray-500">Date Range</p><p className="font-semibold">{viewLeave.fromDate} to {viewLeave.toDate}</p></div>
              <div><p className="text-gray-500">Days</p><p className="font-semibold">{viewLeave.days}</p></div>
              <div className="md:col-span-2"><p className="text-gray-500">Reason</p><p className="font-semibold">{viewLeave.reason}</p></div>
            </div>
            <div className="flex justify-end border-t bg-gray-50 p-5"><Button type="button" variant="secondary" onClick={() => setViewLeave(null)}>Close</Button></div>
          </div>
        </div>
      )}
    </div>
  );
};
