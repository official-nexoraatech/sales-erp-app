import React, { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Eye, IndianRupee, Printer, WalletCards } from 'lucide-react';
import toast from 'react-hot-toast';
import { staffApi } from '../../api/endpoints';
import type { Payroll, PayrollRequest, PayrollStatus } from '../../api/endpoints';
import { queryClient } from '../../app/queryClient';
import { Button } from '../../components/ui/Button';
import { Loader } from '../../components/ui/Loader';
import { formatCurrency } from '../../utils/formatCurrency';
import { inputClass, labelClass, payrollStatuses, pretty, statusClass } from './staffShared';

const currentMonth = new Date().toISOString().slice(5, 7);
const currentYear = String(new Date().getFullYear());
const currentPayrollMonth = new Date().toISOString().slice(0, 7);
const today = new Date().toISOString().slice(0, 10);

const emptyPayroll: PayrollRequest = {
  employeeId: 0,
  payrollMonth: currentPayrollMonth,
  basicSalary: 0,
  hra: 0,
  allowance: 0,
  overtimeAmount: 0,
  deductions: 0,
  tax: 0,
  paymentDate: today,
  status: 'GENERATED',
};

export const StaffPayrollPage: React.FC = () => {
  const [filters, setFilters] = useState({ month: currentMonth, year: currentYear });
  const [modalOpen, setModalOpen] = useState(false);
  const [payslip, setPayslip] = useState<Payroll | null>(null);
  const [form, setForm] = useState<PayrollRequest>(emptyPayroll);

  const payroll = useQuery({ queryKey: ['staff-payroll', filters], queryFn: () => staffApi.getPayroll(filters) });
  const employees = useQuery({ queryKey: ['staff-employees-options'], queryFn: () => staffApi.getEmployees({ page: 0, size: 100 }) });
  const rows = payroll.data?.data || [];
  const grossPay = form.basicSalary + form.hra + form.allowance + form.overtimeAmount;
  const netPay = grossPay - form.deductions - form.tax;

  const summary = useMemo(() => ({
    totalEmployees: employees.data?.data?.totalElements || 0,
    grossPay: rows.reduce((sum, row) => sum + row.grossPay, 0),
    deductions: rows.reduce((sum, row) => sum + row.deductions + row.tax, 0),
    netPay: rows.reduce((sum, row) => sum + row.netPay, 0),
    pendingPayroll: rows.filter((row) => row.status !== 'PAID').length,
  }), [employees.data?.data?.totalElements, rows]);

  const generate = useMutation({
    mutationFn: () => staffApi.createPayroll(form),
    onSuccess: () => {
      toast.success('Payroll generated');
      setModalOpen(false);
      setForm(emptyPayroll);
      queryClient.invalidateQueries({ queryKey: ['staff-payroll'] });
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to generate payroll'),
  });
  const markPaid = useMutation({
    mutationFn: staffApi.markPayrollPaid,
    onSuccess: () => {
      toast.success('Payroll marked paid');
      queryClient.invalidateQueries({ queryKey: ['staff-payroll'] });
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to update payroll'),
  });

  const set = (field: keyof PayrollRequest, value: string | number) => setForm((current) => ({ ...current, [field]: value }));
  const selectEmployee = (employeeId: number) => {
    const employee = employees.data?.data?.content.find((entry) => entry.id === employeeId);
    setForm((current) => ({
      ...current,
      employeeId,
      basicSalary: employee?.basicSalary || current.basicSalary,
      hra: employee?.hra || current.hra,
      allowance: employee?.allowance || current.allowance,
      deductions: employee?.deductions || current.deductions,
    }));
  };
  const submit = () => {
    if (!form.employeeId) return toast.error('Employee is required');
    if (!form.payrollMonth) return toast.error('Payroll month is required');
    generate.mutate();
  };

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Staff Management &gt; Payroll</div>
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
          <h1 className="text-xl font-semibold text-gray-900">Payroll</h1>
          <Button type="button" onClick={() => setModalOpen(true)}><WalletCards size={16} /> Generate Payroll</Button>
        </div>

        <div className="grid grid-cols-2 gap-3 p-5 lg:grid-cols-5">
          <Summary label="Total Employees" value={summary.totalEmployees} />
          <Summary label="Gross Pay" value={formatCurrency(summary.grossPay)} />
          <Summary label="Deductions" value={formatCurrency(summary.deductions)} />
          <Summary label="Net Pay" value={formatCurrency(summary.netPay)} />
          <Summary label="Pending Payroll" value={summary.pendingPayroll} />
        </div>

        <div className="grid grid-cols-1 gap-4 border-t p-5 md:grid-cols-3">
          <label className={labelClass}>Month<select className={`${inputClass} mt-1`} value={filters.month} onChange={(event) => setFilters((current) => ({ ...current, month: event.target.value }))}>{Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0')).map((month) => <option key={month} value={month}>{month}</option>)}</select></label>
          <label className={labelClass}>Year<input className={`${inputClass} mt-1`} value={filters.year} onChange={(event) => setFilters((current) => ({ ...current, year: event.target.value }))} /></label>
          <div className="self-end"><Button type="button" variant="outline">Export</Button></div>
        </div>

        <div className="overflow-x-auto px-3 pb-3">
          {payroll.isLoading ? <div className="p-10"><Loader /></div> : (
            <table className="w-full min-w-[1120px] text-sm">
              <thead className="bg-gray-50">
                <tr>{['Employee', 'Month', 'Basic', 'Allowance', 'Deduction', 'Gross Pay', 'Net Pay', 'Status', 'Action'].map((heading) => <th key={heading} className="border p-3 text-left">{heading}</th>)}</tr>
              </thead>
              <tbody>
                {rows.length ? rows.map((row) => (
                  <tr key={row.id} className="border-b even:bg-gray-50">
                    <td className="border p-3"><span className="font-semibold">{row.employeeName}</span><span className="block text-xs text-gray-500">{row.employeeCode}</span></td>
                    <td className="border p-3">{row.payrollMonth}</td>
                    <td className="border p-3">{formatCurrency(row.basicSalary)}</td>
                    <td className="border p-3">{formatCurrency(row.hra + row.allowance + row.overtimeAmount)}</td>
                    <td className="border p-3">{formatCurrency(row.deductions + row.tax)}</td>
                    <td className="border p-3">{formatCurrency(row.grossPay)}</td>
                    <td className="border p-3 font-semibold">{formatCurrency(row.netPay)}</td>
                    <td className="border p-3"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClass(row.status)}`}>{pretty(row.status)}</span></td>
                    <td className="border p-3"><div className="flex gap-2"><button type="button" onClick={() => setPayslip(row)} className="text-blue-600"><Eye size={16} /></button><button type="button" onClick={() => markPaid.mutate(row.id)} className="text-green-600"><IndianRupee size={16} /></button></div></td>
                  </tr>
                )) : <tr><td colSpan={9} className="bg-gray-50 p-5 text-center">No payroll records found</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-4xl overflow-hidden rounded-lg bg-white shadow-xl">
            <div className="border-b px-5 py-4"><h2 className="text-lg font-semibold">Generate Payroll</h2></div>
            <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-3">
              <label className={labelClass}>Employee<select className={`${inputClass} mt-1`} value={form.employeeId} onChange={(event) => selectEmployee(Number(event.target.value))}><option value={0}>Select employee</option>{(employees.data?.data?.content || []).map((employee) => <option key={employee.id} value={employee.id}>{employee.employeeCode} / {employee.firstName} {employee.lastName}</option>)}</select></label>
              <label className={labelClass}>Payroll Month<input type="month" className={`${inputClass} mt-1`} value={form.payrollMonth} onChange={(event) => set('payrollMonth', event.target.value)} /></label>
              <label className={labelClass}>Payment Date<input type="date" className={`${inputClass} mt-1`} value={form.paymentDate} onChange={(event) => set('paymentDate', event.target.value)} /></label>
              <label className={labelClass}>Basic Salary<input type="number" className={`${inputClass} mt-1`} value={form.basicSalary || ''} onChange={(event) => set('basicSalary', Number(event.target.value))} /></label>
              <label className={labelClass}>HRA<input type="number" className={`${inputClass} mt-1`} value={form.hra || ''} onChange={(event) => set('hra', Number(event.target.value))} /></label>
              <label className={labelClass}>Allowance<input type="number" className={`${inputClass} mt-1`} value={form.allowance || ''} onChange={(event) => set('allowance', Number(event.target.value))} /></label>
              <label className={labelClass}>Overtime Amount<input type="number" className={`${inputClass} mt-1`} value={form.overtimeAmount || ''} onChange={(event) => set('overtimeAmount', Number(event.target.value))} /></label>
              <label className={labelClass}>Deductions<input type="number" className={`${inputClass} mt-1`} value={form.deductions || ''} onChange={(event) => set('deductions', Number(event.target.value))} /></label>
              <label className={labelClass}>Tax<input type="number" className={`${inputClass} mt-1`} value={form.tax || ''} onChange={(event) => set('tax', Number(event.target.value))} /></label>
              <label className={labelClass}>Status<select className={`${inputClass} mt-1`} value={form.status} onChange={(event) => set('status', event.target.value as PayrollStatus)}>{payrollStatuses.map((entry) => <option key={entry} value={entry}>{pretty(entry)}</option>)}</select></label>
              <div className="rounded border bg-gray-50 p-4 md:col-span-2"><p className="text-sm text-gray-500">Net Pay</p><p className="text-2xl font-bold">{formatCurrency(netPay)}</p></div>
            </div>
            <div className="flex justify-end gap-3 border-t bg-gray-50 p-5">
              <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Close</Button>
              <Button type="button" isLoading={generate.isPending} onClick={submit}>Submit</Button>
            </div>
          </div>
        </div>
      )}

      {payslip && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-5 py-4"><h2 className="text-lg font-semibold">Payslip</h2><button type="button" className="text-blue-600"><Printer size={18} /></button></div>
            <div className="p-5">
              <div className="mb-5 border-b pb-4">
                <p className="text-xl font-bold">{payslip.employeeName}</p>
                <p className="text-sm text-gray-500">{payslip.employeeCode} / {payslip.payrollMonth}</p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <PayslipLine label="Basic Salary" value={payslip.basicSalary} />
                <PayslipLine label="HRA" value={payslip.hra} />
                <PayslipLine label="Allowance" value={payslip.allowance} />
                <PayslipLine label="Overtime" value={payslip.overtimeAmount} />
                <PayslipLine label="Deductions" value={-payslip.deductions} />
                <PayslipLine label="Tax" value={-payslip.tax} />
                <div className="col-span-2 mt-3 flex justify-between border-t pt-3 text-lg font-bold"><span>Net Pay</span><span>{formatCurrency(payslip.netPay)}</span></div>
              </div>
            </div>
            <div className="flex justify-end border-t bg-gray-50 p-5"><Button type="button" variant="secondary" onClick={() => setPayslip(null)}>Close</Button></div>
          </div>
        </div>
      )}
    </div>
  );
};

const Summary = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="rounded border bg-gray-50 p-4">
    <p className="text-sm text-gray-500">{label}</p>
    <p className="text-xl font-bold text-gray-900">{value}</p>
  </div>
);

const PayslipLine = ({ label, value }: { label: string; value: number }) => (
  <div className="flex justify-between border-b py-2">
    <span>{label}</span>
    <span className="font-semibold">{formatCurrency(value)}</span>
  </div>
);
