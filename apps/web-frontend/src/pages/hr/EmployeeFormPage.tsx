import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { employeeApi, departmentApi, designationApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPFormSection from '../../components/erp/ERPFormSection.js';
import ERPTabs from '../../components/erp/ERPTabs.js';
import { ERPFormSkeleton } from '../../components/erp/ERPSkeleton.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import Button from '../../components/ui/Button.js';
import { employeeFormSchema, EMPLOYMENT_TYPES, type EmployeeFormData } from '../../schemas/employee.schema.js';
import { useDirtyFormGuard } from '../../hooks/useDirtyFormGuard.js';

interface Department { id: number; name: string; }
interface Designation { id: number; name: string; }

const TABS = ['Basic', 'Employment', 'Bank & Tax'] as const;

const EMPLOYMENT_TYPE_LABELS: Record<(typeof EMPLOYMENT_TYPES)[number], string> = {
  FULL_TIME: 'Full Time',
  PART_TIME: 'Part Time',
  CONTRACT: 'Contract',
  DAILY_WAGE: 'Daily Wage',
  TRAINEE: 'Trainee',
  TAILOR: 'Tailor',
};

export default function EmployeeFormPage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const isEdit = !!id;
  const [tab, setTab] = useState<(typeof TABS)[number]>('Basic');

  const { data: empData, isLoading: isLoadingEmployee } = useQuery({
    queryKey: ['employees', id],
    queryFn: () => employeeApi.getById(Number(id)),
    enabled: isEdit,
  });
  const employee = (empData as Record<string, unknown>)?.data as Record<string, unknown> | undefined ?? (empData as Record<string, unknown>);

  const { data: deptData } = useQuery({ queryKey: ['departments'], queryFn: () => departmentApi.list(), enabled: hasPermission(PERMISSIONS.EMPLOYEE_VIEW) });
  const departments: Department[] = ((deptData as Record<string, unknown>)?.content as Department[]) ?? [];

  const { data: desigData } = useQuery({ queryKey: ['designations'], queryFn: () => designationApi.list(), enabled: hasPermission(PERMISSIONS.EMPLOYEE_VIEW) });
  const designations: Designation[] = ((desigData as Record<string, unknown>)?.content as Designation[]) ?? [];

  const { register, handleSubmit, reset, formState: { errors, isSubmitting, isDirty } } = useForm<EmployeeFormData>({
    resolver: zodResolver(employeeFormSchema),
    defaultValues: { employmentType: 'FULL_TIME', pfApplicable: true, esiApplicable: true },
  });
  useDirtyFormGuard(isDirty);

  useEffect(() => {
    if (employee) reset(employee as unknown as EmployeeFormData);
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

  function onSubmit(d: EmployeeFormData) {
    const payload: Record<string, unknown> = { ...d };
    if (isEdit) payload['version'] = (employee?.['version'] as number) ?? 0;
    mutation.mutate(payload);
  }

  if (isLoadingEmployee) return <ERPFormSkeleton />;

  return (
    <div>
      <ERPPageHeader variant="list" title={isEdit ? 'Edit Employee' : 'New Employee'} subtitle="Full employee record — salary data is encrypted at rest." />

      <ERPTabs
        className="mb-5"
        tabs={TABS.map((t) => ({ key: t, label: t }))}
        active={tab}
        onChange={(key) => setTab(key as typeof tab)}
      />

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
        {tab === 'Basic' && (
          <ERPFormSection title="Basic Information" columns={2}>
            <Input label="First Name" required {...register('firstName')} error={errors.firstName?.message} />
            <Input label="Last Name" required {...register('lastName')} error={errors.lastName?.message} />
            <Input label="Phone" required {...register('phone')} error={errors.phone?.message} />
            <Input label="Email" type="email" {...register('email')} error={errors.email?.message} />
            <Select label="Gender" {...register('gender')} error={errors.gender?.message}>
              <option value="">Select…</option>
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
              <option value="OTHER">Other</option>
            </Select>
            <Input label="Date of Birth" type="date" {...register('dateOfBirth')} error={errors.dateOfBirth?.message} />
            <Input
              label="Aadhaar (last 4 digits only)"
              maxLength={4}
              {...register('aadhaarLast4')}
              error={errors.aadhaarLast4?.message}
              hint="Only last 4 digits are stored — full Aadhaar is never collected"
            />
          </ERPFormSection>
        )}

        {tab === 'Employment' && (
          <ERPFormSection title="Employment Details" columns={2}>
            <Select label="Employment Type" required {...register('employmentType')} error={errors.employmentType?.message}>
              {EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{EMPLOYMENT_TYPE_LABELS[t]}</option>)}
            </Select>
            <Input label="Joining Date" type="date" required {...register('joiningDate')} error={errors.joiningDate?.message} />
            <Select label="Department" {...register('departmentId')} error={errors.departmentId?.message}>
              <option value="">Select…</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
            <Select label="Designation" {...register('designationId')} error={errors.designationId?.message}>
              <option value="">Select…</option>
              {designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </ERPFormSection>
        )}

        {tab === 'Bank & Tax' && (
          <>
            <ERPFormSection title="Sensitive — encrypted at rest (AES-256-GCM)" columns={2}>
              <Input label="PAN" placeholder="ABCDE1234F" wrapperClassName="sm:col-span-2" {...register('pan')} error={errors.pan?.message} />
              <Input label="Bank Name" {...register('bankName')} error={errors.bankName?.message} />
              <Input label="IFSC Code" {...register('bankIfsc')} error={errors.bankIfsc?.message} />
              <Input
                label="Bank Account Number"
                type="password"
                wrapperClassName="sm:col-span-2"
                {...register('bankAccountNo')}
                error={errors.bankAccountNo?.message}
                hint="Stored encrypted; never logged or returned in list views"
              />
            </ERPFormSection>

            <ERPFormSection title="Statutory (PF / ESI)" columns={2}>
              <Input
                label="UAN (Universal Account Number)"
                maxLength={12}
                {...register('uan')}
                error={errors.uan?.message}
              />
              <Input label="ESI Number" maxLength={17} {...register('esiNumber')} error={errors.esiNumber?.message} />
              <div className="flex items-center gap-6 sm:col-span-2">
                <label className="flex items-center gap-2 text-sm text-secondary">
                  <input type="checkbox" {...register('pfApplicable')} className="rounded border-default" />
                  PF Applicable
                </label>
                <label className="flex items-center gap-2 text-sm text-secondary">
                  <input type="checkbox" {...register('esiApplicable')} className="rounded border-default" />
                  ESI Applicable
                </label>
              </div>
            </ERPFormSection>
          </>
        )}

        <div className="flex gap-3">
          <Button type="submit" loading={isSubmitting || mutation.isPending}>{isEdit ? 'Update' : 'Create'} Employee</Button>
          <Button variant="secondary" type="button" onClick={() => navigate('/hr/employees')}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}
