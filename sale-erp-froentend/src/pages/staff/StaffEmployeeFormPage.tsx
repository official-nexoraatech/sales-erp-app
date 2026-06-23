import React, { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FileText, Upload } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { locationApi, staffApi } from '../../api/endpoints';
import type { Country, EmployeeAddressRequest, EmployeeRequest, EmploymentType, State } from '../../api/endpoints';
import { queryClient } from '../../app/queryClient';
import { Button } from '../../components/ui/Button';
import { Loader } from '../../components/ui/Loader';
import { employeeStatuses, employmentTypes, inputClass, labelClass, paymentModes, pretty } from './staffShared';

const today = new Date().toISOString().slice(0, 10);

type EmployeeFormState = Omit<EmployeeRequest, 'address'> & {
  address: EmployeeAddressRequest;
};

const emptyAddress = (): EmployeeAddressRequest => ({
  addressLine1: '',
  addressLine2: '',
  city: '',
  stateId: 0,
  countryId: 0,
  pincode: '',
});

const emptyEmployee: EmployeeFormState = {
  employeeCode: '',
  firstName: '',
  lastName: '',
  gender: 'Male',
  dob: today,
  mobile: '',
  email: '',
  address: emptyAddress(),
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

const optionName = (option: Country | State) => option.name
  || ('stateName' in option ? option.stateName : undefined)
  || ('countryName' in option ? option.countryName : undefined)
  || `#${option.id}`;

const hasAddressValue = (address: EmployeeAddressRequest) => Boolean(
  address.addressLine1.trim()
  || address.addressLine2?.trim()
  || address.city.trim()
  || address.pincode.trim()
  || address.stateId
  || address.countryId
);

const normalizeAddress = (address: EmployeeAddressRequest): EmployeeAddressRequest | undefined => {
  if (!hasAddressValue(address)) return undefined;
  return {
    addressLine1: address.addressLine1.trim(),
    addressLine2: address.addressLine2?.trim() || '',
    city: address.city.trim(),
    stateId: Number(address.stateId),
    countryId: Number(address.countryId),
    pincode: address.pincode.trim(),
  };
};

const toEmployeeRequest = (form: EmployeeFormState): EmployeeRequest => {
  const address = normalizeAddress(form.address);
  const { address: _formAddress, ...payload } = form;
  return {
    ...payload,
    ...(address ? { address } : {}),
  };
};

interface Props {
  mode?: 'create' | 'edit';
}

export const StaffEmployeeFormPage: React.FC<Props> = ({ mode = 'create' }) => {
  const navigate = useNavigate();
  const id = Number(useParams<{ id: string }>().id);
  const [form, setForm] = useState<EmployeeFormState>(emptyEmployee);
  const countryId = Number(form.address.countryId || 0);

  const employee = useQuery({
    queryKey: ['staff-employee', id],
    queryFn: () => staffApi.getEmployeeById(id),
    enabled: mode === 'edit' && id > 0,
  });
  const departments = useQuery({ queryKey: ['staff-departments-options'], queryFn: staffApi.getDepartments });
  const designations = useQuery({ queryKey: ['staff-designations-options'], queryFn: staffApi.getDesignations });
  const countries = useQuery({ queryKey: ['countries'], queryFn: locationApi.getCountries });
  const states = useQuery({
    queryKey: ['states', countryId],
    queryFn: () => locationApi.getStates(countryId),
    enabled: countryId > 0,
  });

  useEffect(() => {
    const data = employee.data?.data;
    if (data) {
      const { id: _id, address, ...payload } = data;
      setForm({
        ...payload,
        address: typeof address === 'string'
          ? { ...emptyAddress(), addressLine1: address }
          : { ...emptyAddress(), ...(address || {}) },
      });
    }
  }, [employee.data?.data]);

  const mutation = useMutation({
    mutationFn: (payload: EmployeeRequest) => mode === 'edit'
      ? staffApi.updateEmployee(id, payload)
      : staffApi.createEmployee(payload),
    onSuccess: () => {
      toast.success(`Employee ${mode === 'edit' ? 'updated' : 'created'} successfully`);
      queryClient.invalidateQueries({ queryKey: ['staff-employees'] });
      navigate('/staff/employees');
    },
    onError: (error: any) => toast.error(error?.message || `Failed to ${mode} employee`),
  });

  const set = (field: keyof Omit<EmployeeFormState, 'address'>, value: string | number) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const setAddress = <K extends keyof EmployeeAddressRequest>(field: K, value: EmployeeAddressRequest[K]) => {
    setForm((current) => ({
      ...current,
      address: { ...current.address, [field]: value },
    }));
  };

  const submit = () => {
    if (!form.employeeCode.trim()) return toast.error('Employee code is required');
    if (!form.firstName.trim()) return toast.error('First name is required');
    if (!form.lastName.trim()) return toast.error('Last name is required');
    if (!form.mobile.trim()) return toast.error('Mobile is required');
    if (!form.email.trim()) return toast.error('Email is required');
    if (!form.department.trim()) return toast.error('Department is required');
    if (!form.designation.trim()) return toast.error('Designation is required');
    if (hasAddressValue(form.address)) {
      if (!form.address.addressLine1.trim()) return toast.error('Address line 1 is required');
      if (!form.address.city.trim()) return toast.error('City is required');
      if (!form.address.countryId) return toast.error('Country is required');
      if (!form.address.stateId) return toast.error('State is required');
      if (!/^[0-9]{5,10}$/.test(form.address.pincode.trim())) return toast.error('Pincode must contain 5 to 10 digits');
    }
    mutation.mutate(toEmployeeRequest(form));
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
          </div>
        </section>

        <section className="border-b p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Address</h2>
            <span className="text-xs font-medium text-gray-500">Optional</span>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className={labelClass}>Address Line 1<input className={`${inputClass} mt-1`} placeholder="Enter address line 1" value={form.address.addressLine1} onChange={(event) => setAddress('addressLine1', event.target.value)} /></label>
            <label className={labelClass}>Address Line 2<input className={`${inputClass} mt-1`} placeholder="Enter address line 2" value={form.address.addressLine2 || ''} onChange={(event) => setAddress('addressLine2', event.target.value)} /></label>
            <label className={labelClass}>City<input className={`${inputClass} mt-1`} placeholder="Enter city" value={form.address.city} onChange={(event) => setAddress('city', event.target.value)} /></label>
            <label className={labelClass}>Pincode<input className={`${inputClass} mt-1`} placeholder="Enter pincode" value={form.address.pincode} onChange={(event) => setAddress('pincode', event.target.value)} /></label>
            <label className={labelClass}>
              Country
              <select
                className={`${inputClass} mt-1`}
                value={form.address.countryId}
                disabled={countries.isLoading}
                onChange={(event) => {
                  setAddress('countryId', Number(event.target.value));
                  setAddress('stateId', 0);
                }}
              >
                <option value={0}>{countries.isLoading ? 'Loading countries...' : 'Select country'}</option>
                {(countries.data?.data || []).map((country) => <option key={country.id} value={country.id}>{optionName(country)}</option>)}
              </select>
            </label>
            <label className={labelClass}>
              State
              <select
                className={`${inputClass} mt-1`}
                value={form.address.stateId}
                disabled={!countryId || states.isLoading}
                onChange={(event) => setAddress('stateId', Number(event.target.value))}
              >
                <option value={0}>{!countryId ? 'Select country first' : states.isLoading ? 'Loading states...' : 'Select state'}</option>
                {(states.data?.data || []).map((state) => <option key={state.id} value={state.id}>{optionName(state)}</option>)}
              </select>
            </label>
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
