import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { employeeApi, departmentApi, designationApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import DataTable from '../../components/ui/DataTable.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import Modal from '../../components/ui/Modal.js';

interface Employee {
  id: number;
  employeeCode: string;
  displayName: string;
  phone: string;
  employmentType: string;
  departmentId?: number;
  designationId?: number;
  status: string;
}

interface Department { id: number; name: string; code: string; }
interface Designation { id: number; name: string; code: string; }

const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'DAILY_WAGE', 'TRAINEE', 'TAILOR'];

export default function EmployeesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [search, setSearch] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [employmentType, setEmploymentType] = useState('');
  const [deptModalOpen, setDeptModalOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['employees', search, departmentId, employmentType],
    queryFn: () => employeeApi.list({
      search: search || undefined,
      departmentId: departmentId ? Number(departmentId) : undefined,
      employmentType: employmentType || undefined,
    }),
  });
  const employees: Employee[] = ((data as Record<string, unknown>)?.content as Employee[]) ?? [];

  const { data: deptData } = useQuery({ queryKey: ['departments'], queryFn: () => departmentApi.list() });
  const departments: Department[] = ((deptData as Record<string, unknown>)?.content as Department[]) ?? [];

  const { data: desigData } = useQuery({ queryKey: ['designations'], queryFn: () => designationApi.list() });
  const designations: Designation[] = ((desigData as Record<string, unknown>)?.content as Designation[]) ?? [];

  const deptName = (id?: number) => departments.find((d) => d.id === id)?.name ?? '–';
  const desigName = (id?: number) => designations.find((d) => d.id === id)?.name ?? '–';

  const columns = [
    { key: 'employeeCode', header: 'Code', className: 'font-mono text-xs' },
    {
      key: 'displayName', header: 'Name',
      render: (r: Employee) => (
        <div>
          <p className="font-medium">{r.displayName}</p>
          <p className="text-xs text-gray-400">{r.phone}</p>
        </div>
      ),
    },
    { key: 'department', header: 'Department', render: (r: Employee) => deptName(r.departmentId) },
    { key: 'designation', header: 'Designation', render: (r: Employee) => desigName(r.designationId) },
    { key: 'employmentType', header: 'Type', render: (r: Employee) => <Badge variant="outline">{r.employmentType}</Badge> },
    {
      key: 'status', header: 'Status',
      render: (r: Employee) => <Badge variant={r.status === 'ACTIVE' ? 'success' : 'default'}>{r.status}</Badge>,
    },
    {
      key: 'actions', header: '',
      render: (r: Employee) => (
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => navigate(`/hr/employees/${r.id}`)}>View</Button>
          {hasPermission(PERMISSIONS.EMPLOYEE_UPDATE) && (
            <Button size="sm" variant="ghost" onClick={() => navigate(`/hr/employees/${r.id}/edit`)}>Edit</Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Employees"
        subtitle="Manage your workforce, departments, and designations."
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setDeptModalOpen(true)}>Departments</Button>
            {hasPermission(PERMISSIONS.EMPLOYEE_CREATE) && (
              <Button onClick={() => navigate('/hr/employees/new')}>+ New Employee</Button>
            )}
          </div>
        }
      />

      <div className="flex gap-3 mb-4 flex-wrap">
        <Input placeholder="Search employees…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="max-w-xs">
          <option value="">All Departments</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Select>
        <Select value={employmentType} onChange={(e) => setEmploymentType(e.target.value)} className="max-w-xs">
          <option value="">All Employment Types</option>
          {EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
        </Select>
      </div>

      <DataTable columns={columns} data={employees} loading={isLoading} emptyMessage="No employees found." />

      <DepartmentDesignationModal
        open={deptModalOpen}
        onClose={() => setDeptModalOpen(false)}
        departments={departments}
        designations={designations}
        onChanged={() => { qc.invalidateQueries({ queryKey: ['departments'] }); qc.invalidateQueries({ queryKey: ['designations'] }); }}
      />
    </div>
  );
}

function DepartmentDesignationModal({
  open, onClose, departments, designations, onChanged,
}: {
  open: boolean; onClose: () => void; departments: Department[]; designations: Designation[]; onChanged: () => void;
}) {
  const [tab, setTab] = useState<'department' | 'designation'>('department');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');

  const createDept = useMutation({
    mutationFn: () => departmentApi.create({ name, code }),
    onSuccess: () => { toast.success('Department added'); setName(''); setCode(''); onChanged(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const createDesig = useMutation({
    mutationFn: () => designationApi.create({ name, code }),
    onSuccess: () => { toast.success('Designation added'); setName(''); setCode(''); onChanged(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Modal open={open} onClose={onClose} title="Departments & Designations" size="md">
      <div className="flex gap-2 mb-4">
        <Button size="sm" variant={tab === 'department' ? 'primary' : 'secondary'} onClick={() => setTab('department')}>Departments</Button>
        <Button size="sm" variant={tab === 'designation' ? 'primary' : 'secondary'} onClick={() => setTab('designation')}>Designations</Button>
      </div>

      <div className="flex gap-2 mb-4">
        <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} className="max-w-[120px]" />
        <Button
          onClick={() => (tab === 'department' ? createDept.mutate() : createDesig.mutate())}
          loading={createDept.isPending || createDesig.isPending}
          disabled={!name || !code}
        >
          Add
        </Button>
      </div>

      <ul className="divide-y divide-default max-h-64 overflow-y-auto">
        {(tab === 'department' ? departments : designations).map((item) => (
          <li key={item.id} className="py-2 flex justify-between text-sm">
            <span>{item.name}</span>
            <span className="text-secondary font-mono text-xs">{item.code}</span>
          </li>
        ))}
        {(tab === 'department' ? departments : designations).length === 0 && (
          <li className="py-4 text-center text-disabled text-sm">None yet.</li>
        )}
      </ul>
    </Modal>
  );
}
