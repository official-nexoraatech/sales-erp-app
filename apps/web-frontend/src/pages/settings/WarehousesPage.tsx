import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Pencil, Trash2 } from 'lucide-react';
import { warehouseApi, branchApi } from '../../api/endpoints.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { useConfirm } from '../../context/ConfirmContext.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPDataGrid, { type ERPColumnDef } from '../../components/erp/ERPDataGrid.js';
import ERPDropdownMenu, { type ERPMenuItem } from '../../components/erp/ERPDropdownMenu.js';
import Button from '../../components/ui/Button.js';
import Modal from '../../components/ui/Modal.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import Badge from '../../components/ui/Badge.js';

interface Warehouse { id: number; name: string; code: string; branchId: number; isDefault: boolean; isActive: boolean; }
interface Branch { id: number; name: string; }

export default function WarehousesPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canManageWarehouse = hasPermission(PERMISSIONS.WAREHOUSE_MANAGE);
  const [modal, setModal] = useState<{ open: boolean; wh?: Warehouse }>({ open: false });
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 250);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => { setPage(1); }, [debouncedSearch]);

  const { data, isLoading } = useQuery({
    queryKey: ['warehouses', debouncedSearch, page, pageSize],
    queryFn: () => warehouseApi.list({ search: debouncedSearch || undefined, page: page - 1, size: pageSize }),
  });
  const { data: branchData } = useQuery({ queryKey: ['branches'], queryFn: () => branchApi.list(), enabled: hasPermission(PERMISSIONS.BRANCH_VIEW) });

  const warehouses: Warehouse[] = (data as { content?: Warehouse[] })?.content ?? [];
  const totalElements = (data as { totalElements?: number })?.totalElements ?? 0;
  const branches: Branch[] = (branchData as { content?: Branch[] })?.content ?? [];

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Partial<Warehouse>>();

  function openNew() { reset({}); setModal({ open: true }); }
  function openEdit(wh: Warehouse) { reset(wh); setModal({ open: true, wh }); }

  const saveMutation = useMutation({
    mutationFn: (d: Record<string, unknown>) =>
      modal.wh ? warehouseApi.update(modal.wh!.id, d) : warehouseApi.create(d),
    onSuccess: () => { toast.success('Saved'); qc.invalidateQueries({ queryKey: ['warehouses'] }); setModal({ open: false }); },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => warehouseApi.delete(id),
    onSuccess: () => { toast.success('Deleted'); qc.invalidateQueries({ queryKey: ['warehouses'] }); },
    onError: (err: Error) => toast.error(err.message),
  });

  const columns: ERPColumnDef<Warehouse>[] = [
    { key: 'code', header: 'Code', mono: true, sortable: true },
    { key: 'name', header: 'Name', sortable: true },
    {
      key: 'branchId', header: 'Branch',
      render: (r) => branches.find((b) => b.id === r.branchId)?.name ?? r.branchId,
    },
    {
      key: 'isDefault', header: 'Default',
      render: (r) => r.isDefault ? <Badge variant="info">Default</Badge> : null,
    },
    {
      key: 'isActive', header: 'Status', sortable: true,
      render: (r) => <Badge variant={r.isActive ? 'success' : 'default'}>{r.isActive ? 'Active' : 'Inactive'}</Badge>,
    },
    {
      key: 'actions', header: '', align: 'right', sticky: 'right',
      render: (r) => {
        const items: ERPMenuItem[] = [];
        if (canManageWarehouse) items.push({ label: 'Edit', icon: Pencil, onClick: () => openEdit(r) });
        if (canManageWarehouse) items.push({ label: 'Delete', icon: Trash2, variant: 'danger', onClick: async () => {
          const ok = await confirm({
            title: 'Delete Warehouse',
            message: `Are you sure you want to delete warehouse "${r.name}"? This cannot be undone.`,
            confirmLabel: 'Delete',
            variant: 'danger',
          });
          if (ok) deleteMutation.mutate(r.id);
        } });
        return items.length > 0 ? <ERPDropdownMenu items={items} /> : null;
      },
    },
  ];

  return (
    <div>
      <ERPPageHeader variant="list" title="Warehouses" subtitle="Manage warehouse/godown locations." actions={canManageWarehouse ? <Button onClick={openNew}>+ New Warehouse</Button> : undefined} />
      <div className="flex gap-3 mb-4">
        <Input placeholder="Search warehouses…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
      </div>

      <ERPDataGrid
        columns={columns}
        data={warehouses}
        isLoading={isLoading}
        rowKey="id"
        pagination={{ page, pageSize, total: totalElements }}
        onPageChange={setPage}
        onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
      />

      <Modal open={modal.open} onClose={() => setModal({ open: false })} title={modal.wh ? 'Edit Warehouse' : 'New Warehouse'}>
        <form onSubmit={handleSubmit((d) => saveMutation.mutate(d as Record<string, unknown>))} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Name" required {...register('name', { required: 'Required' })} error={errors.name?.message} />
            <Input label="Code" required {...register('code', { required: 'Required' })} error={errors.code?.message} />
          </div>
          <Select label="Branch" required {...register('branchId', { required: 'Required', valueAsNumber: true })} error={errors.branchId?.message}>
            <option value="">Select branch…</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="isDefault" {...register('isDefault')} className="rounded border-gray-300 dark:border-gray-600" />
            <label htmlFor="isDefault" className="text-sm text-gray-700 dark:text-gray-300">Set as Default</label>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => setModal({ open: false })}>Cancel</Button>
            <Button type="submit" loading={isSubmitting || saveMutation.isPending}>Save</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
