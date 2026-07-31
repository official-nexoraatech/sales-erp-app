import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { apiKeyApi } from '../../api/endpoints.js';
import { PUBLIC_API_SCOPES } from '../../constants/publicApiScopes.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPCardSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import { formatDate } from '../../lib/format.js';

interface ApiKey {
  id: number;
  name: string;
  keyPrefix: string;
  scopes: string[];
  isActive: boolean;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export default function ApiKeysPage(): React.ReactElement {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>([]);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['crm-api-keys'],
    queryFn: () => apiKeyApi.list(),
  });
  const keys = ((data as { content?: ApiKey[] })?.content ?? []) as ApiKey[];

  const createMut = useMutation({
    mutationFn: () => apiKeyApi.create({ name, scopes }),
    onSuccess: (res) => {
      const plaintextKey = (res as { plaintextKey?: string })?.plaintextKey;
      setCreatedKey(plaintextKey ?? null);
      setName('');
      setScopes([]);
      setShowForm(false);
      void queryClient.invalidateQueries({ queryKey: ['crm-api-keys'] });
    },
    onError: () => toast.error('Could not create API key'),
  });

  const revokeMut = useMutation({
    mutationFn: (id: number) => apiKeyApi.revoke(id),
    onSuccess: () => {
      toast.success('API key revoked');
      void queryClient.invalidateQueries({ queryKey: ['crm-api-keys'] });
    },
    onError: () => toast.error('Could not revoke API key'),
  });

  function toggleScope(scope: string): void {
    setScopes((cur) => (cur.includes(scope) ? cur.filter((s) => s !== scope) : [...cur, scope]));
  }

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="API Keys"
        subtitle="Manage credentials for the public CRM API — read-only access for external BI/integration tools"
        actions={
          <Button onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : '+ New API Key'}
          </Button>
        }
      />

      {createdKey && (
        <div className="mb-6 rounded-xl border border-warning bg-warning-subtle p-4">
          <p className="text-sm font-semibold text-primary">
            Copy this key now — it will not be shown again
          </p>
          <code className="mt-2 block break-all rounded-md bg-surface-card px-3 py-2 text-xs">
            {createdKey}
          </code>
          <Button
            size="sm"
            variant="secondary"
            className="mt-2"
            onClick={() => setCreatedKey(null)}
          >
            I've copied it
          </Button>
        </div>
      )}

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
            <label className="text-xs text-secondary">Scopes (read-only)</label>
            <div className="mt-1 flex flex-wrap gap-2">
              {PUBLIC_API_SCOPES.map((scope) => (
                <label
                  key={scope}
                  className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border border-default bg-surface-page"
                >
                  <input
                    type="checkbox"
                    checked={scopes.includes(scope)}
                    onChange={() => toggleScope(scope)}
                  />
                  {scope}
                </label>
              ))}
            </div>
          </div>
          <Button type="submit" disabled={createMut.isPending || scopes.length === 0}>
            {createMut.isPending ? 'Creating…' : 'Create API Key'}
          </Button>
        </form>
      )}

      <div className="bg-surface-card rounded-xl border border-default">
        <div className="px-5 py-4 border-b border-default">
          <h2 className="text-sm font-semibold text-primary">All API Keys</h2>
        </div>
        {isLoading ? (
          <div className="p-4">
            <ERPCardSkeleton lines={2} />
          </div>
        ) : keys.length === 0 ? (
          <ERPEmptyState
            type="no-data"
            title="No API keys yet"
            description="Create an API key to let external BI tools read CRM data."
            action={{ label: '+ New API Key', onClick: () => setShowForm(true) }}
          />
        ) : (
          <div className="divide-y divide-default">
            {keys.map((k) => (
              <div
                key={k.id}
                className="flex items-center justify-between px-5 py-3 flex-wrap gap-2"
              >
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-primary">{k.name}</p>
                    <Badge
                      label={k.isActive ? 'ACTIVE' : 'REVOKED'}
                      color={k.isActive ? 'green' : 'gray'}
                    />
                  </div>
                  <p className="text-xs text-secondary font-mono">{k.keyPrefix}…</p>
                  <p className="text-xs text-secondary">
                    {k.scopes.join(', ')} · Created {formatDate(k.createdAt)}
                    {k.lastUsedAt ? ` · Last used ${formatDate(k.lastUsedAt)}` : ' · Never used'}
                  </p>
                </div>
                {k.isActive && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={revokeMut.isPending}
                    onClick={() => revokeMut.mutate(k.id)}
                  >
                    Revoke
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
