import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Eye, Pencil, Trash2 } from 'lucide-react';
import { employeeApi, departmentApi, designationApi } from '../../api/endpoints.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { useAuthStore } from '../../store/auth.store.js';
import { useConfirm } from '../../context/ConfirmContext.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPDataGrid, {
  type ERPColumnDef,
  type ERPRowAction,
} from '../../components/erp/ERPDataGrid.js';
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

interface Department {
  id: number;
  name: string;
  code: string;
}
interface Designation {
  id: number;
  name: string;
  code: string;
}

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

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, departmentId, employmentType]);

  const { data, isLoading } = useQuery({
    queryKey: ['employees', debouncedSearch, departmentId, employmentType, page, pageSize],
    queryFn: () =>
      employeeApi.list({
        search: debouncedSearch || undefined,
        departmentId: departmentId ? Number(departmentId) : undefined,
        employmentType: employmentType || undefined,
        page: page - 1,
        size: pageSize,
      }),
  });
  const employees: Employee[] = ((data as Record<string, unknown>)?.content as Employee[]) ?? [];
  const totalElements = ((data as Record<string, unknown>)?.totalElements as number) ?? 0;

  const { data: deptData } = useQuery({
    queryKey: ['departments'],
    queryFn: () => departmentApi.list(),
  });
  const departments: Department[] =
    ((deptData as Record<string, unknown>)?.content as Department[]) ?? [];

  const { data: desigData } = useQuery({
    queryKey: ['designations'],
    queryFn: () => designationApi.list(),
  });
  const designations: Designation[] =
    ((desigData as Record<string, unknown>)?.content as Designation[]) ?? [];

  const deptName = (id?: number) => departments.find((d) => d.id === id)?.name ?? '–';
  const desigName = (id?: number) => designations.find((d) => d.id === id)?.name ?? '–';

  const columns: ERPColumnDef<Employee>[] = [
    { key: 'employeeCode', header: 'Code', mono: true, sortable: true },
    {
      key: 'displayName',
      header: 'Name',
      sortable: true,
      render: (r) => (
        <div>
          <p className="font-medium">{r.displayName}</p>
          <p className="text-xs text-secondary">{r.phone}</p>
        </div>
      ),
    },
    { key: 'department', header: 'Department', render: (r) => deptName(r.departmentId) },
    { key: 'designation', header: 'Designation', render: (r) => desigName(r.designationId) },
    {
      key: 'employmentType',
      header: 'Type',
      render: (r) => <Badge variant="outline">{r.employmentType}</Badge>,
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (r) => (
        <Badge variant={r.status === 'ACTIVE' ? 'success' : 'default'}>{r.status}</Badge>
      ),
    },
  ];

  const rowActions: ERPRowAction<Employee>[] = [
    {
      label: 'View',
      icon: Eye,
      type: 'view',
      onClick: (r: Employee) => navigate(`/hr/employees/${r.id}`),
    },
    ...(hasPermission(PERMISSIONS.EMPLOYEE_UPDATE)
      ? [
          {
            label: 'Edit',
            icon: Pencil,
            type: 'edit' as const,
            onClick: (r: Employee) => navigate(`/hr/employees/${r.id}/edit`),
          },
        ]
      : []),
  ];

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Employees"
        subtitle="Manage your workforce, departments, and designations."
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button variant="secondary" onClick={() => setDeptModalOpen(true)}>
              Departments
            </Button>
            {hasPermission(PERMISSIONS.EMPLOYEE_CREATE) && (
              <Button
                data-tour-id="hr-employees-create-button"
                onClick={() => navigate('/hr/employees/new')}
              >
                + New Employee
              </Button>
            )}
          </div>
        }
      />

      <div className="flex gap-3 mb-4 flex-wrap">
        <Input
          placeholder="Search employees…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
          className="max-w-xs"
        >
          <option value="">All Departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
        <Select
          value={employmentType}
          onChange={(e) => setEmploymentType(e.target.value)}
          className="max-w-xs"
        >
          <option value="">All Employment Types</option>
          {EMPLOYMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace('_', ' ')}
            </option>
          ))}
        </Select>
      </div>

      <ERPDataGrid
        columns={columns}
        data={employees}
        isLoading={isLoading}
        rowKey="id"
        pagination={{ page, pageSize, total: totalElements }}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        actions={rowActions}
      />

      <DepartmentDesignationModal
        open={deptModalOpen}
        onClose={() => setDeptModalOpen(false)}
        departments={departments}
        designations={designations}
        onChanged={() => {
          qc.invalidateQueries({ queryKey: ['departments'] });
          qc.invalidateQueries({ queryKey: ['designations'] });
        }}
      />
    </div>
  );
}

function DepartmentDesignationModal({
  open,
  onClose,
  departments,
  designations,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  departments: Department[];
  designations: Designation[];
  onChanged: () => void;
}) {
  const canCreate = useAuthStore((s) => s.hasPermission(PERMISSIONS.EMPLOYEE_CREATE));
  const canDelete = useAuthStore((s) => s.hasPermission(PERMISSIONS.EMPLOYEE_DELETE));
  const confirm = useConfirm();
  const [tab, setTab] = useState<'department' | 'designation'>('department');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);

  function resetForm() {
    setEditingId(null);
    setName('');
    setCode('');
  }

  function startEdit(item: Department | Designation) {
    setEditingId(item.id);
    setName(item.name);
    setCode(item.code);
  }

  const createDept = useMutation({
    mutationFn: () => departmentApi.create({ name, code }),
    onSuccess: () => {
      toast.success('Department added');
      resetForm();
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const updateDept = useMutation({
    mutationFn: (id: number) => departmentApi.update(id, { name, code }),
    onSuccess: () => {
      toast.success('Department updated');
      resetForm();
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteDept = useMutation({
    mutationFn: (id: number) => departmentApi.delete(id),
    onSuccess: () => {
      toast.success('Department deleted');
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createDesig = useMutation({
    mutationFn: () => designationApi.create({ name, code }),
    onSuccess: () => {
      toast.success('Designation added');
      resetForm();
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const updateDesig = useMutation({
    mutationFn: (id: number) => designationApi.update(id, { name, code }),
    onSuccess: () => {
      toast.success('Designation updated');
      resetForm();
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteDesig = useMutation({
    mutationFn: (id: number) => designationApi.delete(id),
    onSuccess: () => {
      toast.success('Designation deleted');
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isSaving =
    createDept.isPending || createDesig.isPending || updateDept.isPending || updateDesig.isPending;

  function handleSave() {
    if (tab === 'department') {
      if (editingId !== null) updateDept.mutate(editingId);
      else createDept.mutate();
    } else {
      if (editingId !== null) updateDesig.mutate(editingId);
      else createDesig.mutate();
    }
  }

  async function handleDelete(item: Department | Designation) {
    const ok = await confirm({
      title: `Delete ${tab === 'department' ? 'department' : 'designation'}?`,
      message: `Delete "${item.name}"? Employees currently assigned to it will keep their existing assignment on record.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    if (tab === 'department') deleteDept.mutate(item.id);
    else deleteDesig.mutate(item.id);
  }

  const items = tab === 'department' ? departments : designations;

  return (
    <Modal open={open} onClose={onClose} title="Departments & Designations" size="md">
      <div className="flex gap-2 mb-4">
        <Button
          size="sm"
          variant={tab === 'department' ? 'primary' : 'secondary'}
          onClick={() => {
            setTab('department');
            resetForm();
          }}
        >
          Departments
        </Button>
        <Button
          size="sm"
          variant={tab === 'designation' ? 'primary' : 'secondary'}
          onClick={() => {
            setTab('designation');
            resetForm();
          }}
        >
          Designations
        </Button>
      </div>

      {canCreate && (
        <div className="flex gap-2 mb-4">
          <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input
            placeholder="Code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="max-w-[120px]"
          />
          <Button onClick={handleSave} loading={isSaving} disabled={!name || !code}>
            {editingId !== null ? 'Save' : 'Add'}
          </Button>
          {editingId !== null && (
            <Button variant="secondary" onClick={resetForm}>
              Cancel
            </Button>
          )}
        </div>
      )}

      <ul className="divide-y divide-default max-h-64 overflow-y-auto">
        {items.map((item) => (
          <li key={item.id} className="py-2 flex items-center justify-between text-sm">
            <span>{item.name}</span>
            <div className="flex items-center gap-3">
              <span className="text-secondary font-mono text-xs">{item.code}</span>
              {canCreate && (
                <button
                  type="button"
                  onClick={() => startEdit(item)}
                  className="p-1 rounded hover:bg-surface-hover text-secondary hover:text-primary"
                  title="Edit"
                >
                  <Pencil size={14} />
                </button>
              )}
              {canDelete && (
                <button
                  type="button"
                  onClick={() => void handleDelete(item)}
                  className="p-1 rounded hover:bg-surface-hover text-secondary hover:text-danger"
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </li>
        ))}
        {items.length === 0 && (
          <li className="py-4 text-center text-disabled text-sm">None yet.</li>
        )}
      </ul>
    </Modal>
  );
}
