import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { employeeApi, departmentApi, designationApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import Button from '../../components/ui/Button.js';

interface Department { id: number; name: string; }
interface Designation { id: number; name: string; }

interface FormData {
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  gender?: string;
  dateOfBirth?: string;
  aadhaarLast4?: string;
  pan?: string;
  bankAccountNo?: string;
  bankName?: string;
  bankIfsc?: string;
  employmentType: string;
  departmentId?: number;
  designationId?: number;
  joiningDate: string;
  version?: number;
}

const TABS = ['Basic', 'Employment', 'Bank & Tax'] as const;

export default function EmployeeFormPage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isEdit = !!id;
  const [tab, setTab] = useState<(typeof TABS)[number]>('Basic');

  const { data: empData } = useQuery({
    queryKey: ['employees', id],
    queryFn: () => employeeApi.getById(Number(id)),
    enabled: isEdit,
  });
  const employee = (empData as Record<string, unknown>)?.data as Record<string, unknown> | undefined ?? (empData as Record<string, unknown>);

  const { data: deptData } = useQuery({ queryKey: ['departments'], queryFn: () => departmentApi.list() });
  const departments: Department[] = ((deptData as Record<string, unknown>)?.content as Department[]) ?? [];

  const { data: desigData } = useQuery({ queryKey: ['designations'], queryFn: () => designationApi.list() });
  const designations: Designation[] = ((desigData as Record<string, unknown>)?.content as Designation[]) ?? [];

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormData>({
    defaultValues: { employmentType: 'FULL_TIME' },
  });

  useEffect(() => {
    if (employee) reset(employee as unknown as FormData);
  }, [employee, reset]);

  const mutation = useMutation({
    mutationFn: (d: Record<string, unknown>) =>
      isEdit ? employeeApi.update(Number(id), d) : employeeApi.create(d),
    onSuccess: () => {
      toast.success(isEdit ? 'Employee updated' : 'Employee created');
      qc.invalidateQueries({ queryKey: ['employees'] });
      navigate('/hr/employees');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function onSubmit(d: FormData) {
    const payload: Record<string, unknown> = { ...d };
    if (isEdit) payload['version'] = (employee?.['version'] as number) ?? 0;
    mutation.mutate(payload);
  }

  return (
    <div>
      <ERPPageHeader variant="list" title={isEdit ? 'Edit Employee' : 'New Employee'} subtitle="Full employee record — salary data is encrypted at rest." />

      <div className="flex gap-2 mb-5 border-b border-default">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t ? 'border-brand text-brand' : 'border-transparent text-secondary hover:text-primary'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="max-w-2xl space-y-5">
        {tab === 'Basic' && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <Input label="First Name" required {...register('firstName', { required: 'Required' })} error={errors.firstName?.message} />
              <Input label="Last Name" required {...register('lastName', { required: 'Required' })} error={errors.lastName?.message} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input label="Phone" required {...register('phone', { required: 'Required' })} error={errors.phone?.message} />
              <Input label="Email" type="email" {...register('email')} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Select label="Gender" {...register('gender')}>
                <option value="">Select…</option>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
                <option value="OTHER">Other</option>
              </Select>
              <Input label="Date of Birth" type="date" {...register('dateOfBirth')} />
            </div>
            <Input label="Aadhaar (last 4 digits only)" maxLength={4} {...register('aadhaarLast4')} hint="Only last 4 digits are stored — full Aadhaar is never collected" />
          </>
        )}

        {tab === 'Employment' && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <Select label="Employment Type" required {...register('employmentType', { required: true })}>
                <option value="FULL_TIME">Full Time</option>
                <option value="PART_TIME">Part Time</option>
                <option value="CONTRACT">Contract</option>
                <option value="DAILY_WAGE">Daily Wage</option>
                <option value="TRAINEE">Trainee</option>
                <option value="TAILOR">Tailor</option>
              </Select>
              <Input label="Joining Date" type="date" required {...register('joiningDate', { required: 'Required' })} error={errors.joiningDate?.message} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Select label="Department" {...register('departmentId', { valueAsNumber: true })}>
                <option value="">Select…</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
              <Select label="Designation" {...register('designationId', { valueAsNumber: true })}>
                <option value="">Select…</option>
                {designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </div>
          </>
        )}

        {tab === 'Bank & Tax' && (
          <fieldset className="border border-default rounded-lg p-4 space-y-4">
            <legend className="text-xs font-semibold text-secondary px-1">Sensitive — encrypted at rest (AES-256-GCM)</legend>
            <Input label="PAN" placeholder="ABCDE1234F" {...register('pan')} />
            <div className="grid grid-cols-2 gap-4">
              <Input label="Bank Name" {...register('bankName')} />
              <Input label="IFSC Code" {...register('bankIfsc')} />
            </div>
            <Input label="Bank Account Number" type="password" {...register('bankAccountNo')} hint="Stored encrypted; never logged or returned in list views" />
          </fieldset>
        )}

        <div className="flex gap-3 pt-2">
          <Button type="submit" loading={isSubmitting || mutation.isPending}>{isEdit ? 'Update' : 'Create'} Employee</Button>
          <Button variant="secondary" type="button" onClick={() => navigate('/hr/employees')}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}
