import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { costCenterApi } from '../../api/endpoints.js';
import { useConfirm } from '../../context/ConfirmContext.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import ERPDataGrid, { type ERPColumnDef } from '../../components/erp/ERPDataGrid.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';

interface CostCenter {
  id: number;
  code: string;
  name: string;
  parentId?: number | null;
  isActive: boolean;
}

export default function CostCentersPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const canManage = useAuthStore((s) => s.hasPermission(PERMISSIONS.COST_CENTER_MANAGE));
  const [showForm, setShowForm] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['cost-centers'],
    queryFn: () => costCenterApi.list(),
  });
  const costCenters = (data as CostCenter[]) ?? [];

  const createMutation = useMutation({
    mutationFn: () =>
      costCenterApi.create({
        code,
        name,
        ...(parentId ? { parentId: Number(parentId) } : {}),
      }),
    onSuccess: () => {
      toast.success('Cost center created');
      qc.invalidateQueries({ queryKey: ['cost-centers'] });
      setShowForm(false);
      setCode('');
      setName('');
      setParentId('');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => costCenterApi.delete(id),
    onSuccess: () => {
      toast.success('Cost center deactivated');
      qc.invalidateQueries({ queryKey: ['cost-centers'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const columns: ERPColumnDef<CostCenter>[] = [
    {
      key: 'code',
      header: 'Code',
      render: (cc) => <span className="font-mono text-xs text-secondary">{cc.code}</span>,
    },
    {
      key: 'name',
      header: 'Name',
      render: (cc) => <span className="text-sm text-primary">{cc.name}</span>,
    },
    {
      key: 'parent',
      header: 'Parent',
      render: (cc) => {
        const parent = costCenters.find((p) => p.id === cc.parentId);
        return (
          <span className="text-xs text-secondary">
            {parent ? `${parent.code} — ${parent.name}` : '—'}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (cc) => (
        <Badge label={cc.isActive ? 'Active' : 'Inactive'} color={cc.isActive ? 'green' : 'gray'} />
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      hideable: false,
      render: (cc) =>
        canManage && cc.isActive ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              const ok = await confirm({
                title: 'Deactivate Cost Center',
                message: `Deactivate ${cc.code} — ${cc.name}? It will no longer be selectable for new postings.`,
                confirmLabel: 'Deactivate',
                variant: 'danger',
              });
              if (ok) deleteMutation.mutate(cc.id);
            }}
          >
            Deactivate
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <ERPPageHeader
        variant="list"
        title="Cost Centers"
        subtitle="Tag departments or locations for cost-center reporting (optional)"
        actions={
          canManage ? (
            <Button onClick={() => setShowForm((s) => !s)}>
              {showForm ? 'Cancel' : '+ New Cost Center'}
            </Button>
          ) : undefined
        }
      />

      {showForm && (
        <div className="bg-surface-card rounded-xl border border-default p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createMutation.mutate();
            }}
            className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end"
          >
            <Input
              label="Code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={30}
            />
            <Input
              label="Name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={300}
            />
            <Select
              label="Parent (optional)"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
            >
              <option value="">None</option>
              {costCenters
                .filter((cc) => cc.isActive)
                .map((cc) => (
                  <option key={cc.id} value={cc.id}>
                    {cc.code} — {cc.name}
                  </option>
                ))}
            </Select>
            <div className="sm:col-span-3">
              <Button type="submit" loading={createMutation.isPending}>
                Create Cost Center
              </Button>
            </div>
          </form>
        </div>
      )}

      <ERPDataGrid
        columns={columns}
        data={costCenters}
        isLoading={isLoading}
        rowKey="id"
        emptyState={
          <ERPEmptyState
            type="no-data"
            title="No cost centers yet"
            description="Cost centers let you tag postings by department or location for a separate P&L cut. Optional — accounts and journals work exactly the same without them."
            {...(canManage
              ? { action: { label: '+ New Cost Center', onClick: () => setShowForm(true) } }
              : {})}
          />
        }
      />
    </div>
  );
}
