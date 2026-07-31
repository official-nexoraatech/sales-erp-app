import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { crmApi, branchApi, userApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPCardSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';

interface Territory {
  id: number;
  name: string;
  description?: string | null;
  isActive: boolean;
  version: number;
}

interface Branch {
  id: number;
  name: string;
}

interface StaffUser {
  id: number;
  firstName: string;
  lastName: string;
}

interface Coverage {
  branches: Array<{ id: number; name: string }>;
  users: Array<{ id: number; firstName: string; lastName: string }>;
  leadCount: number;
  opportunityCount: number;
}

function TerritoryAssignmentPanel({ territory }: { territory: Territory }): React.ReactElement {
  const queryClient = useQueryClient();
  const { data: coverage, isLoading: coverageLoading } = useQuery({
    queryKey: ['crm-territory-coverage', territory.id],
    queryFn: () => crmApi.territoryCoverage(territory.id) as Promise<Coverage>,
  });
  const { data: branchData } = useQuery({
    queryKey: ['branches-for-territory'],
    queryFn: () => branchApi.list({ size: 200 }),
  });
  const { data: userData } = useQuery({
    queryKey: ['users-for-territory'],
    queryFn: () => userApi.list(),
  });

  const branches = ((branchData as { content?: Branch[] })?.content ?? []) as Branch[];
  const staffUsers = ((userData as { content?: StaffUser[] })?.content ?? []) as StaffUser[];

  const [selectedBranchIds, setSelectedBranchIds] = useState<number[] | null>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<number[] | null>(null);

  const branchIds = selectedBranchIds ?? coverage?.branches.map((b) => b.id) ?? [];
  const userIds = selectedUserIds ?? coverage?.users.map((u) => u.id) ?? [];

  const saveBranchesMut = useMutation({
    mutationFn: () => crmApi.setTerritoryBranches(territory.id, branchIds),
    onSuccess: () => {
      toast.success('Branches updated');
      setSelectedBranchIds(null);
      void queryClient.invalidateQueries({ queryKey: ['crm-territory-coverage', territory.id] });
    },
    onError: () => toast.error('Could not update branches'),
  });

  const saveUsersMut = useMutation({
    mutationFn: () => crmApi.setTerritoryUsers(territory.id, userIds),
    onSuccess: () => {
      toast.success('Reps updated');
      setSelectedUserIds(null);
      void queryClient.invalidateQueries({ queryKey: ['crm-territory-coverage', territory.id] });
    },
    onError: () => toast.error('Could not update reps'),
  });

  function toggleBranch(id: number): void {
    setSelectedBranchIds((cur) => {
      const base = cur ?? coverage?.branches.map((b) => b.id) ?? [];
      return base.includes(id) ? base.filter((b) => b !== id) : [...base, id];
    });
  }

  function toggleUser(id: number): void {
    setSelectedUserIds((cur) => {
      const base = cur ?? coverage?.users.map((u) => u.id) ?? [];
      return base.includes(id) ? base.filter((u) => u !== id) : [...base, id];
    });
  }

  if (coverageLoading) return <p className="text-xs text-secondary px-5 py-2">Loading coverage…</p>;

  return (
    <div className="px-5 py-4 bg-surface-subtle space-y-4">
      <div className="flex gap-6 text-xs text-secondary">
        <span>{coverage?.leadCount ?? 0} leads</span>
        <span>{coverage?.opportunityCount ?? 0} opportunities</span>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-primary uppercase tracking-wide">Branches</h3>
          <Button
            size="sm"
            variant="secondary"
            disabled={saveBranchesMut.isPending || selectedBranchIds === null}
            onClick={() => saveBranchesMut.mutate()}
          >
            Save Branches
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {branches.map((b) => (
            <label
              key={b.id}
              className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border border-default bg-surface-card"
            >
              <input
                type="checkbox"
                checked={branchIds.includes(b.id)}
                onChange={() => toggleBranch(b.id)}
              />
              {b.name}
            </label>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-primary uppercase tracking-wide">Reps</h3>
          <Button
            size="sm"
            variant="secondary"
            disabled={saveUsersMut.isPending || selectedUserIds === null}
            onClick={() => saveUsersMut.mutate()}
          >
            Save Reps
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {staffUsers.map((u) => (
            <label
              key={u.id}
              className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border border-default bg-surface-card"
            >
              <input
                type="checkbox"
                checked={userIds.includes(u.id)}
                onChange={() => toggleUser(u.id)}
              />
              {u.firstName} {u.lastName}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function TerritoriesPage(): React.ReactElement {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canManage = hasPermission(PERMISSIONS.TERRITORY_MANAGE);
  const queryClient = useQueryClient();

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['crm-territories'],
    queryFn: () => crmApi.listTerritories(),
  });
  const territories = ((data as { content?: Territory[] })?.content ?? []) as Territory[];

  const createMut = useMutation({
    mutationFn: () => crmApi.createTerritory({ name, ...(description ? { description } : {}) }),
    onSuccess: () => {
      toast.success('Territory created');
      setName('');
      setDescription('');
      setShowForm(false);
      void queryClient.invalidateQueries({ queryKey: ['crm-territories'] });
    },
    onError: () => toast.error('Could not create territory'),
  });

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Territories"
        subtitle="Group branches into named regions for rep and quota assignment"
        actions={
          canManage ? (
            <Button onClick={() => setShowForm((v) => !v)}>
              {showForm ? 'Cancel' : '+ New Territory'}
            </Button>
          ) : undefined
        }
      />

      {showForm && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createMut.mutate();
          }}
          className="mb-6 space-y-3 rounded-xl border border-default bg-surface-card p-4"
        >
          <div>
            <label className="text-xs text-secondary">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              className="mt-1 w-full rounded-md border border-default bg-surface-page px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-secondary">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border border-default bg-surface-page px-3 py-2 text-sm"
            />
          </div>
          <Button type="submit" disabled={createMut.isPending}>
            {createMut.isPending ? 'Creating…' : 'Create Territory'}
          </Button>
        </form>
      )}

      <div className="bg-surface-card rounded-xl border border-default">
        <div className="px-5 py-4 border-b border-default">
          <h2 className="text-sm font-semibold text-primary">All Territories</h2>
        </div>
        {isLoading ? (
          <div className="p-4">
            <ERPCardSkeleton lines={2} />
          </div>
        ) : territories.length === 0 ? (
          <ERPEmptyState
            type="no-data"
            title="No territories yet"
            description="Create a territory to group branches for rep and quota assignment beyond single-branch scoping."
            {...(canManage
              ? { action: { label: '+ New Territory', onClick: () => setShowForm(true) } }
              : {})}
          />
        ) : (
          <div className="divide-y divide-default">
            {territories.map((t) => (
              <div key={t.id}>
                <div className="flex items-center justify-between px-5 py-3 flex-wrap gap-2">
                  <div>
                    <p className="text-sm font-medium text-primary">{t.name}</p>
                    {t.description && <p className="text-xs text-secondary">{t.description}</p>}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setExpandedId((cur) => (cur === t.id ? null : t.id))}
                  >
                    {expandedId === t.id ? 'Hide' : 'Manage Coverage'}
                  </Button>
                </div>
                {expandedId === t.id && <TerritoryAssignmentPanel territory={t} />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
