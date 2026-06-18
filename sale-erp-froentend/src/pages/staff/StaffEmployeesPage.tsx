import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Edit, Eye, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { staffApi } from '../../api/endpoints';
import type { Employee } from '../../api/endpoints';
import { queryClient } from '../../app/queryClient';
import { Button } from '../../components/ui/Button';
import { Loader } from '../../components/ui/Loader';
import { Pagination } from '../../components/ui/Pagination';
import { useDebounce } from '../../hooks/useDebounce';
import { formatDate } from '../../utils/formatDate';
import { employeeStatuses, fullName, inputClass, pretty, statusClass } from './staffShared';

const columns = ['Employee Code', 'Name', 'Mobile', 'Email', 'Department', 'Designation', 'Joining Date', 'Status', 'Action'];

export const StaffEmployeesPage: React.FC = () => {
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [department, setDepartment] = useState('');
  const debouncedSearch = useDebounce(search);

  const employees = useQuery({
    queryKey: ['staff-employees', page, pageSize, debouncedSearch, status, department],
    queryFn: () => staffApi.getEmployees({ page, size: pageSize, search: debouncedSearch, status, department }),
  });
  const departments = useQuery({ queryKey: ['staff-departments-options'], queryFn: staffApi.getDepartments });
  const rows = employees.data?.data?.content || [];

  const remove = useMutation({
    mutationFn: staffApi.deleteEmployee,
    onSuccess: () => {
      toast.success('Employee deleted');
      queryClient.invalidateQueries({ queryKey: ['staff-employees'] });
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to delete employee'),
  });

  const copy = async () => {
    const exportRows = rows.map((row) => [row.employeeCode, fullName(row.firstName, row.lastName), row.mobile, row.email, row.department, row.designation, row.joiningDate, row.status]);
    await navigator.clipboard.writeText([columns.slice(0, -1), ...exportRows].map((entry) => entry.join('\t')).join('\n'));
    toast.success('Employees copied');
  };

  const resetPage = () => setPage(0);

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Staff Management &gt; Employees</div>
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
          <h1 className="text-xl font-semibold text-gray-900">Employees</h1>
          <Button onClick={() => navigate('/staff/employees/create')} className="min-w-[150px]">Create Employee</Button>
        </div>

        <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-4">
          <label className="text-sm text-gray-600">Search
            <input className={`${inputClass} mt-1`} value={search} onChange={(event) => { setSearch(event.target.value); resetPage(); }} placeholder="Name, code, mobile, email" />
          </label>
          <label className="text-sm text-gray-600">Status
            <select className={`${inputClass} mt-1`} value={status} onChange={(event) => { setStatus(event.target.value); resetPage(); }}>
              <option value="">All status</option>
              {employeeStatuses.map((entry) => <option key={entry} value={entry}>{pretty(entry)}</option>)}
            </select>
          </label>
          <label className="text-sm text-gray-600">Department
            <select className={`${inputClass} mt-1`} value={department} onChange={(event) => { setDepartment(event.target.value); resetPage(); }}>
              <option value="">All departments</option>
              {(departments.data?.data || []).map((entry) => <option key={entry.id} value={entry.name}>{entry.name}</option>)}
            </select>
          </label>
          <label className="text-sm text-gray-600">Show
            <select className={`${inputClass} mt-1`} value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); resetPage(); }}>
              <option>10</option>
              <option>20</option>
              <option>50</option>
              <option>100</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 px-5 pb-4">
          <button type="button" onClick={copy} className="h-10 rounded border px-4 text-sm">Copy</button>
          <button type="button" onClick={copy} className="h-10 rounded border px-4 text-sm">Excel</button>
          <button type="button" onClick={copy} className="h-10 rounded border px-4 text-sm">CSV</button>
          <button type="button" onClick={copy} className="h-10 rounded border px-4 text-sm">PDF</button>
        </div>

        <div className="overflow-x-auto px-3 pb-3">
          {employees.isLoading ? <div className="p-10"><Loader /></div> : (
            <table className="w-full min-w-[1120px] text-sm">
              <thead className="bg-gray-50">
                <tr>{columns.map((heading) => <th key={heading} className="border p-3 text-left">{heading}</th>)}</tr>
              </thead>
              <tbody>
                {rows.length ? rows.map((employee: Employee) => (
                  <tr key={employee.id} className="border-b even:bg-gray-50">
                    <td className="border p-3 font-semibold">{employee.employeeCode}</td>
                    <td className="border p-3">{fullName(employee.firstName, employee.lastName)}</td>
                    <td className="border p-3">{employee.mobile}</td>
                    <td className="border p-3">{employee.email}</td>
                    <td className="border p-3">{employee.department}</td>
                    <td className="border p-3">{employee.designation}</td>
                    <td className="border p-3">{formatDate(employee.joiningDate)}</td>
                    <td className="border p-3"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClass(employee.status)}`}>{pretty(employee.status)}</span></td>
                    <td className="border p-3">
                      <div className="flex gap-2">
                        <button type="button" onClick={() => navigate(`/staff/employees/${employee.id}`)} className="text-blue-600"><Eye size={17} /></button>
                        <button type="button" onClick={() => navigate(`/staff/employees/${employee.id}/edit`)} className="text-orange-600"><Edit size={17} /></button>
                        <button type="button" onClick={() => confirm('Delete this employee?') && remove.mutate(employee.id)} className="text-red-600"><Trash2 size={17} /></button>
                      </div>
                    </td>
                  </tr>
                )) : <tr><td colSpan={columns.length} className="bg-gray-50 p-5 text-center">No employees found</td></tr>}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 text-sm text-gray-600">
          <span>Showing {rows.length ? page * pageSize + 1 : 0} to {page * pageSize + rows.length} of {employees.data?.data?.totalElements || 0} entries</span>
          <Pagination page={page} totalPages={employees.data?.data?.totalPages || 1} onPageChange={setPage} />
        </div>
      </div>
    </div>
  );
};
