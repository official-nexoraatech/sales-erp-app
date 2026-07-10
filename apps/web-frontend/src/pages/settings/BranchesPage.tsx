import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Pencil, Trash2 } from 'lucide-react';
import { branchApi } from '../../api/endpoints.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { useConfirm } from '../../context/ConfirmContext.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPDataGrid, { type ERPColumnDef } from '../../components/erp/ERPDataGrid.js';
import ERPDropdownMenu, { type ERPMenuItem } from '../../components/erp/ERPDropdownMenu.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Modal from '../../components/ui/Modal.js';
import Input from '../../components/ui/Input.js';
import Badge from '../../components/ui/Badge.js';

interface Branch {
  id: number;
  name: string;
  code: string;
  city: string;
  state: string;
  isHeadOffice: boolean;
  isActive: boolean;
  gstin?: string;
}

export default function BranchesPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const canManageBranch = useAuthStore((s) => s.hasPermission(PERMISSIONS.BRANCH_MANAGE));
  const [modal, setModal] = useState<{ open: boolean; branch?: Branch }>({ open: false });
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 250);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => { setPage(1); }, [debouncedSearch]);

  const { data, isLoading } = useQuery({
    queryKey: ['branches', debouncedSearch, page, pageSize],
    queryFn: () => branchApi.list({ search: debouncedSearch || undefined, page: page - 1, size: pageSize }),
  });
  const branches: Branch[] = (data as { content?: Branch[] })?.content ?? [];
  const totalElements = (data as { totalElements?: number })?.totalElements ?? 0;

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Partial<Branch> & { pinCode?: string; phone?: string; isHeadOffice?: boolean }>();

  function openNew() { reset({}); setModal({ open: true }); }
  function openEdit(branch: Branch) { reset(branch); setModal({ open: true, branch }); }

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      modal.branch ? branchApi.update(modal.branch!.id, payload) : branchApi.create(payload),
    onSuccess: () => {
      toast.success(modal.branch ? 'Branch updated' : 'Branch created');
      qc.invalidateQueries({ queryKey: ['branches'] });
      setModal({ open: false });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => branchApi.delete(id),
    onSuccess: () => { toast.success('Branch deleted'); qc.invalidateQueries({ queryKey: ['branches'] }); },
    onError: (err: Error) => toast.error(err.message),
  });

  const columns: ERPColumnDef<Branch>[] = [
    { key: 'code', header: 'Code', mono: true, sortable: true },
    { key: 'name', header: 'Name', sortable: true },
    { key: 'city', header: 'City', sortable: true },
    { key: 'state', header: 'State' },
    {
      key: 'isHeadOffice', header: 'HO',
      render: (r) => r.isHeadOffice ? <Badge variant="info">HQ</Badge> : null,
    },
    {
      key: 'isActive', header: 'Status', sortable: true,
      render: (r) => <Badge variant={r.isActive ? 'success' : 'default'}>{r.isActive ? 'Active' : 'Inactive'}</Badge>,
    },
    {
      key: 'actions', header: '', align: 'right', sticky: 'right',
      render: (r) => {
        const items: ERPMenuItem[] = [];
        if (canManageBranch) items.push({ label: 'Edit', icon: Pencil, onClick: () => openEdit(r) });
        if (canManageBranch) items.push({ label: 'Delete', icon: Trash2, variant: 'danger', onClick: async () => {
          const ok = await confirm({
            title: 'Delete Branch',
            message: `Are you sure you want to delete branch "${r.name}"? This cannot be undone.`,
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
      <ERPPageHeader variant="list"
        title="Branches"
        subtitle="Manage your store branches and locations."
        actions={canManageBranch ? <Button onClick={openNew}>+ New Branch</Button> : undefined}
      />

      <div className="flex gap-3 mb-4">
        <Input placeholder="Search branches…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
      </div>

      <ERPDataGrid
        columns={columns}
        data={branches}
        isLoading={isLoading}
        rowKey="id"
        emptyState={<ERPEmptyState type="no-data" title="No branches found" description="Create your first branch." />}
        pagination={{ page, pageSize, total: totalElements }}
        onPageChange={setPage}
        onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
      />

      <Modal open={modal.open} onClose={() => setModal({ open: false })} title={modal.branch ? 'Edit Branch' : 'New Branch'}>
        <form onSubmit={handleSubmit((d) => saveMutation.mutate(d as Record<string, unknown>))} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Branch Name" required {...register('name', { required: 'Required' })} error={errors.name?.message} />
            <Input label="Code" required placeholder="BR001" {...register('code', { required: 'Required' })} error={errors.code?.message} />
          </div>
          <Input label="GSTIN" placeholder="27AAPFU0939F1ZV" {...register('gstin')} />
          <div className="grid grid-cols-3 gap-4">
            <Input label="City" {...register('city')} />
            <Input label="State" {...register('state')} />
            <Input label="PIN Code" {...register('pinCode')} />
          </div>
          <Input label="Phone" {...register('phone')} />
          <div className="flex items-center gap-2">
            <input type="checkbox" id="isHeadOffice" {...register('isHeadOffice')} className="rounded border-gray-300 dark:border-gray-600" />
            <label htmlFor="isHeadOffice" className="text-sm text-gray-700 dark:text-gray-300">Head Office</label>
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
