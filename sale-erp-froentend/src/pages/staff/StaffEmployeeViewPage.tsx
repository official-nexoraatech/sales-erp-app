import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Edit } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { staffApi } from '../../api/endpoints';
import type { EmployeeAddress } from '../../api/endpoints';
import { Button } from '../../components/ui/Button';
import { Loader } from '../../components/ui/Loader';
import { formatDate } from '../../utils/formatDate';
import { formatCurrency } from '../../utils/formatCurrency';
import { fullName, pretty, statusClass } from './staffShared';

const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div>
    <p className="text-sm text-gray-500">{label}</p>
    <p className="font-semibold text-gray-900">{value || 'N/A'}</p>
  </div>
);

const formatAddress = (address: EmployeeAddress | string) => {
  if (typeof address === 'string') return address;
  return [
    address.addressLine1,
    address.addressLine2,
    address.city,
    address.stateName,
    address.countryName,
    address.pincode,
  ].filter(Boolean).join(', ');
};

export const StaffEmployeeViewPage: React.FC = () => {
  const navigate = useNavigate();
  const id = Number(useParams<{ id: string }>().id);
  const employee = useQuery({ queryKey: ['staff-employee', id], queryFn: () => staffApi.getEmployeeById(id), enabled: id > 0 });
  const data = employee.data?.data;

  if (employee.isLoading) return <Loader />;
  if (!data) return <div className="rounded bg-white p-6 shadow">Employee not found.</div>;

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Staff Management &gt; Employees &gt; {data.employeeCode}</div>
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">{fullName(data.firstName, data.lastName)}</h1>
            <p className="text-sm text-gray-500">{data.employeeCode} / {data.department}</p>
          </div>
          <div className="flex gap-2">
            <Button type="button" onClick={() => navigate(`/staff/employees/${data.id}/edit`)}><Edit size={16} /> Edit</Button>
            <Button type="button" variant="secondary" onClick={() => navigate('/staff/employees')}>Back</Button>
          </div>
        </div>

        <section className="border-b p-5">
          <h2 className="mb-4 text-lg font-semibold">Personal Details</h2>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            <Field label="Name" value={fullName(data.firstName, data.lastName)} />
            <Field label="Gender" value={data.gender} />
            <Field label="Date of Birth" value={formatDate(data.dob)} />
            <Field label="Mobile" value={data.mobile} />
            <Field label="Email" value={data.email} />
            <Field label="Address" value={data.address ? formatAddress(data.address) : ''} />
          </div>
        </section>

        <section className="border-b p-5">
          <h2 className="mb-4 text-lg font-semibold">Employment Details</h2>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            <Field label="Department" value={data.department} />
            <Field label="Designation" value={data.designation} />
            <Field label="Joining Date" value={formatDate(data.joiningDate)} />
            <Field label="Employment Type" value={pretty(data.employmentType)} />
            <Field label="Reporting Manager" value={data.reportingManager} />
            <Field label="Status" value={<span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClass(data.status)}`}>{pretty(data.status)}</span>} />
          </div>
        </section>

        <section className="border-b p-5">
          <h2 className="mb-4 text-lg font-semibold">Salary Details</h2>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            <Field label="Basic Salary" value={formatCurrency(data.basicSalary)} />
            <Field label="HRA" value={formatCurrency(data.hra)} />
            <Field label="Allowance" value={formatCurrency(data.allowance)} />
            <Field label="Deductions" value={formatCurrency(data.deductions)} />
            <Field label="Payment Mode" value={data.paymentMode} />
          </div>
        </section>

        <section className="p-5">
          <h2 className="mb-4 text-lg font-semibold">Bank Details</h2>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <Field label="Bank Name" value={data.bankName} />
            <Field label="Account Number" value={data.accountNumber} />
            <Field label="IFSC Code" value={data.ifscCode} />
            <Field label="Account Holder Name" value={data.accountHolderName} />
          </div>
        </section>
      </div>
    </div>
  );
};
