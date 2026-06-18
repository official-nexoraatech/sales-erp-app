import React, { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FileText, Upload } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { staffApi } from '../../api/endpoints';
import type { EmployeeRequest, EmploymentType } from '../../api/endpoints';
import { queryClient } from '../../app/queryClient';
import { Button } from '../../components/ui/Button';
import { Loader } from '../../components/ui/Loader';
import { employeeStatuses, employmentTypes, inputClass, labelClass, paymentModes, pretty, textareaClass } from './staffShared';

const today = new Date().toISOString().slice(0, 10);

const emptyEmployee: EmployeeRequest = {
  employeeCode: '',
  firstName: '',
  lastName: '',
  gender: 'Male',
  dob: today,
  mobile: '',
  email: '',
  address: '',
  department: '',
  designation: '',
  joiningDate: today,
  employmentType: 'FULL_TIME',
  reportingManager: '',
  basicSalary: 0,
  hra: 0,
  allowance: 0,
  deductions: 0,
  paymentMode: 'Bank Transfer',
  bankName: '',
  accountNumber: '',
  ifscCode: '',
  accountHolderName: '',
  status: 'ACTIVE',
};

interface Props {
  mode?: 'create' | 'edit';
}

export const StaffEmployeeFormPage: React.FC<Props> = ({ mode = 'create' }) => {
  const navigate = useNavigate();
  const id = Number(useParams<{ id: string }>().id);
  const [form, setForm] = useState<EmployeeRequest>(emptyEmployee);

  const employee = useQuery({
    queryKey: ['staff-employee', id],
    queryFn: () => staffApi.getEmployeeById(id),
    enabled: mode === 'edit' && id > 0,
  });
  const departments = useQuery({ queryKey: ['staff-departments-options'], queryFn: staffApi.getDepartments });
  const designations = useQuery({ queryKey: ['staff-designations-options'], queryFn: staffApi.getDesignations });

  useEffect(() => {
    const data = employee.data?.data;
    if (data) {
      const { id: _id, ...payload } = data;
      setForm(payload);
    }
  }, [employee.data?.data]);

  const mutation = useMutation({
    mutationFn: () => mode === 'edit' ? staffApi.updateEmployee(id, form) : staffApi.createEmployee(form),
    onSuccess: () => {
      toast.success(`Employee ${mode === 'edit' ? 'updated' : 'created'} successfully`);
      queryClient.invalidateQueries({ queryKey: ['staff-employees'] });
      navigate('/staff/employees');
    },
    onError: (error: any) => toast.error(error?.message || `Failed to ${mode} employee`),
  });

  const set = (field: keyof EmployeeRequest, value: string | number) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const submit = () => {
    if (!form.employeeCode.trim()) return toast.error('Employee code is required');
    if (!form.firstName.trim()) return toast.error('First name is required');
    if (!form.lastName.trim()) return toast.error('Last name is required');
    if (!form.mobile.trim()) return toast.error('Mobile is required');
    if (!form.email.trim()) return toast.error('Email is required');
    if (!form.department.trim()) return toast.error('Department is required');
    if (!form.designation.trim()) return toast.error('Designation is required');
    mutation.mutate();
  };

  if (employee.isLoading) return <Loader />;

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Staff Management &gt; Employees &gt; {mode === 'edit' ? 'Edit Employee' : 'Create Employee'}</div>
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="border-b px-5 py-4">
          <h1 className="text-xl font-semibold text-gray-900">{mode === 'edit' ? 'Edit Employee' : 'Create Employee'}</h1>
        </div>

        <section className="border-b p-5">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Personal Details</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <label className={labelClass}>First Name<input className={`${inputClass} mt-1`} value={form.firstName} onChange={(event) => set('firstName', event.target.value)} /></label>
            <label className={labelClass}>Last Name<input className={`${inputClass} mt-1`} value={form.lastName} onChange={(event) => set('lastName', event.target.value)} /></label>
            <label className={labelClass}>Gender<select className={`${inputClass} mt-1`} value={form.gender} onChange={(event) => set('gender', event.target.value)}><option>Male</option><option>Female</option><option>Other</option></select></label>
            <label className={labelClass}>Date of Birth<input type="date" className={`${inputClass} mt-1`} value={form.dob} onChange={(event) => set('dob', event.target.value)} /></label>
            <label className={labelClass}>Mobile<input className={`${inputClass} mt-1`} value={form.mobile} onChange={(event) => set('mobile', event.target.value)} /></label>
            <label className={labelClass}>Email<input type="email" className={`${inputClass} mt-1`} value={form.email} onChange={(event) => set('email', event.target.value)} /></label>
            <label className={`${labelClass} md:col-span-3`}>Address<textarea className={textareaClass} value={form.address} onChange={(event) => set('address', event.target.value)} /></label>
          </div>
        </section>

        <section className="border-b p-5">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Employment Details</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <label className={labelClass}>Employee Code<input className={`${inputClass} mt-1`} value={form.employeeCode} onChange={(event) => set('employeeCode', event.target.value)} /></label>
            <label className={labelClass}>Department<select className={`${inputClass} mt-1`} value={form.department} onChange={(event) => set('department', event.target.value)}><option value="">Select department</option>{(departments.data?.data || []).map((entry) => <option key={entry.id} value={entry.name}>{entry.name}</option>)}</select></label>
            <label className={labelClass}>Designation<select className={`${inputClass} mt-1`} value={form.designation} onChange={(event) => set('designation', event.target.value)}><option value="">Select designation</option>{(designations.data?.data || []).map((entry) => <option key={entry.id} value={entry.name}>{entry.name}</option>)}</select></label>
            <label className={labelClass}>Joining Date<input type="date" className={`${inputClass} mt-1`} value={form.joiningDate} onChange={(event) => set('joiningDate', event.target.value)} /></label>
            <label className={labelClass}>Employment Type<select className={`${inputClass} mt-1`} value={form.employmentType} onChange={(event) => set('employmentType', event.target.value as EmploymentType)}>{employmentTypes.map((entry) => <option key={entry} value={entry}>{pretty(entry)}</option>)}</select></label>
            <label className={labelClass}>Reporting Manager<input className={`${inputClass} mt-1`} value={form.reportingManager} onChange={(event) => set('reportingManager', event.target.value)} /></label>
            <label className={labelClass}>Status<select className={`${inputClass} mt-1`} value={form.status} onChange={(event) => set('status', event.target.value)}>{employeeStatuses.map((entry) => <option key={entry} value={entry}>{pretty(entry)}</option>)}</select></label>
          </div>
        </section>

        <section className="border-b p-5">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Salary Details</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <label className={labelClass}>Basic Salary<input type="number" className={`${inputClass} mt-1`} value={form.basicSalary || ''} onChange={(event) => set('basicSalary', Number(event.target.value))} /></label>
            <label className={labelClass}>HRA<input type="number" className={`${inputClass} mt-1`} value={form.hra || ''} onChange={(event) => set('hra', Number(event.target.value))} /></label>
            <label className={labelClass}>Allowance<input type="number" className={`${inputClass} mt-1`} value={form.allowance || ''} onChange={(event) => set('allowance', Number(event.target.value))} /></label>
            <label className={labelClass}>Deductions<input type="number" className={`${inputClass} mt-1`} value={form.deductions || ''} onChange={(event) => set('deductions', Number(event.target.value))} /></label>
            <label className={labelClass}>Payment Mode<select className={`${inputClass} mt-1`} value={form.paymentMode} onChange={(event) => set('paymentMode', event.target.value)}>{paymentModes.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
          </div>
        </section>

        <section className="border-b p-5">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Bank Details</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className={labelClass}>Bank Name<input className={`${inputClass} mt-1`} value={form.bankName} onChange={(event) => set('bankName', event.target.value)} /></label>
            <label className={labelClass}>Account Number<input className={`${inputClass} mt-1`} value={form.accountNumber} onChange={(event) => set('accountNumber', event.target.value)} /></label>
            <label className={labelClass}>IFSC Code<input className={`${inputClass} mt-1`} value={form.ifscCode} onChange={(event) => set('ifscCode', event.target.value.toUpperCase())} /></label>
            <label className={labelClass}>Account Holder Name<input className={`${inputClass} mt-1`} value={form.accountHolderName} onChange={(event) => set('accountHolderName', event.target.value)} /></label>
          </div>
        </section>

        <section className="p-5">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Documents</h2>
          <div className="flex flex-wrap items-center gap-4 rounded border border-dashed border-gray-300 bg-gray-50 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded border bg-white text-gray-400"><FileText size={26} /></div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-gray-800">Employee documents</p>
              <p className="text-sm text-gray-500">Upload UI placeholder for ID proof, address proof, offer letter, and certificates.</p>
            </div>
            <button type="button" className="inline-flex h-10 items-center gap-2 rounded border border-blue-500 bg-white px-4 text-sm font-semibold text-blue-600"><Upload size={16} /> Browse</button>
          </div>
        </section>

        <div className="flex gap-3 border-t p-5">
          <Button type="button" isLoading={mutation.isPending} onClick={submit}>Submit</Button>
          <Button type="button" variant="secondary" onClick={() => navigate('/staff/employees')}>Close</Button>
        </div>
      </div>
    </div>
  );
};
