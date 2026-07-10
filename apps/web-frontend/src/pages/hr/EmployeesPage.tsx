import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Eye, Pencil } from 'lucide-react';
import { employeeApi, departmentApi, designationApi } from '../../api/endpoints.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPDataGrid, { type ERPColumnDef } from '../../components/erp/ERPDataGrid.js';
import ERPDropdownMenu, { type ERPMenuItem } from '../../components/erp/ERPDropdownMenu.js';
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
  const debouncedSearch = useDebounce(search, 250);
  const [departmentId, setDepartmentId] = useState('');
  const [employmentType, setEmploymentType] = useState('');
  const [deptModalOpen, setDeptModalOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  useEffect(() => { setPage(1); }, [debouncedSearch, departmentId, employmentType]);

  const { data, isLoading } = useQuery({
    queryKey: ['employees', debouncedSearch, departmentId, employmentType, page, pageSize],
    queryFn: () => employeeApi.list({
      search: debouncedSearch || undefined,
      departmentId: departmentId ? Number(departmentId) : undefined,
      employmentType: employmentType || undefined,
      page: page - 1,
      size: pageSize,
    }),
  });
  const employees: Employee[] = ((data as Record<string, unknown>)?.content as Employee[]) ?? [];
  const totalElements = (data as Record<string, unknown>)?.totalElements as number ?? 0;

  const { data: deptData } = useQuery({ queryKey: ['departments'], queryFn: () => departmentApi.list() });
  const departments: Department[] = ((deptData as Record<string, unknown>)?.content as Department[]) ?? [];

  const { data: desigData } = useQuery({ queryKey: ['designations'], queryFn: () => designationApi.list() });
  const designations: Designation[] = ((desigData as Record<string, unknown>)?.content as Designation[]) ?? [];

  const deptName = (id?: number) => departments.find((d) => d.id === id)?.name ?? '–';
  const desigName = (id?: number) => designations.find((d) => d.id === id)?.name ?? '–';

  const columns: ERPColumnDef<Employee>[] = [
    { key: 'employeeCode', header: 'Code', mono: true, sortable: true },
    {
      key: 'displayName', header: 'Name', sortable: true,
      render: (r) => (
        <div>
          <p className="font-medium">{r.displayName}</p>
          <p className="text-xs text-secondary">{r.phone}</p>
        </div>
      ),
    },
    { key: 'department', header: 'Department', render: (r) => deptName(r.departmentId) },
    { key: 'designation', header: 'Designation', render: (r) => desigName(r.designationId) },
    { key: 'employmentType', header: 'Type', render: (r) => <Badge variant="outline">{r.employmentType}</Badge> },
    {
      key: 'status', header: 'Status', sortable: true,
      render: (r) => <Badge variant={r.status === 'ACTIVE' ? 'success' : 'default'}>{r.status}</Badge>,
    },
    {
      key: 'actions', header: '', align: 'right',
      render: (r) => {
        const items: ERPMenuItem[] = [{ label: 'View', icon: Eye, onClick: () => navigate(`/hr/employees/${r.id}`) }];
        if (hasPermission(PERMISSIONS.EMPLOYEE_UPDATE)) items.push({ label: 'Edit', icon: Pencil, onClick: () => navigate(`/hr/employees/${r.id}/edit`) });
        return <ERPDropdownMenu items={items} />;
      },
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

      <ERPDataGrid
        columns={columns}
        data={employees}
        isLoading={isLoading}
        rowKey="id"
        pagination={{ page, pageSize, total: totalElements }}
        onPageChange={setPage}
        onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
      />

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
  const canCreate = useAuthStore((s) => s.hasPermission(PERMISSIONS.EMPLOYEE_CREATE));
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

      {canCreate && (
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
      )}

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
