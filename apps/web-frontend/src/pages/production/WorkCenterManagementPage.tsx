import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { productionApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Input from '../../components/ui/Input.js';

interface WorkCenter {
  id: number;
  name: string;
  code: string;
  capacityPerDay: string;
  isActive: boolean;
}

export default function WorkCenterManagementPage() {
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [capacityPerDay, setCapacityPerDay] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['work-centers'],
    queryFn: () => productionApi.listWorkCenters(),
  });
  const workCenters: WorkCenter[] = (data as WorkCenter[]) ?? [];

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => productionApi.createWorkCenter(payload),
    onSuccess: () => {
      toast.success('Work center created');
      setShowCreateForm(false);
      setName('');
      setCode('');
      setCapacityPerDay('');
      qc.invalidateQueries({ queryKey: ['work-centers'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      productionApi.updateWorkCenter(id, { isActive }),
    onSuccess: () => {
      toast.success('Work center updated');
      qc.invalidateQueries({ queryKey: ['work-centers'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    createMutation.mutate({
      name,
      code,
      capacityPerDay: capacityPerDay ? parseFloat(capacityPerDay) : undefined,
    });
  }

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Work Centers"
        subtitle="Production stations and machines a Job Work Order can be assigned to."
        actions={
          hasPermission(PERMISSIONS.WORK_CENTER_CREATE) ? (
            <Button onClick={() => setShowCreateForm(!showCreateForm)}>
              {showCreateForm ? 'Cancel' : '+ New Work Center'}
            </Button>
          ) : undefined
        }
      />

      {showCreateForm && (
        <div className="bg-surface-card rounded-xl border border-default p-6 mb-6">
          <h3 className="font-semibold text-primary mb-4">New Work Center</h3>
          <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Input label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
            <Input label="Code" required value={code} onChange={(e) => setCode(e.target.value)} />
            <Input
              label="Capacity per Day"
              type="number"
              min="0"
              step="0.001"
              value={capacityPerDay}
              onChange={(e) => setCapacityPerDay(e.target.value)}
            />
            <div className="col-span-3">
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating…' : 'Create Work Center'}
              </Button>
            </div>
          </form>
        </div>
      )}

      {isLoading ? (
        <ERPTableSkeleton rows={4} cols={4} />
      ) : workCenters.length === 0 ? (
        <ERPEmptyState
          type="no-data"
          title="No work centers yet"
          description="Define production stations or machines to assign Job Work Orders to."
          {...(hasPermission(PERMISSIONS.WORK_CENTER_CREATE)
            ? { action: { label: '+ New Work Center', onClick: () => setShowCreateForm(true) } }
            : {})}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm bg-surface-card rounded-xl border border-default overflow-hidden">
            <thead className="bg-surface-subtle">
              <tr className="text-left text-xs uppercase text-secondary">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3 text-right">Capacity/Day</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-default">
              {workCenters.map((w) => (
                <tr key={w.id} className="hover:bg-surface-subtle">
                  <td className="px-4 py-3">{w.name}</td>
                  <td className="px-4 py-3 font-mono text-xs">{w.code}</td>
                  <td className="px-4 py-3 text-right font-mono">{w.capacityPerDay}</td>
                  <td className="px-4 py-3">
                    <Badge variant={w.isActive ? 'success' : 'default'}>
                      {w.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {hasPermission(PERMISSIONS.WORK_CENTER_UPDATE) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          toggleActiveMutation.mutate({ id: w.id, isActive: !w.isActive })
                        }
                      >
                        {w.isActive ? 'Deactivate' : 'Activate'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
