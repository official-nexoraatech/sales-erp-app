import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { schemaRegistryApi } from '../../../api/endpoints.js';
import { useAuthStore } from '../../../store/auth.store.js';
import { PERMISSIONS } from '../../../constants/permissions.js';
import ERPPageHeader from '../../../components/erp/ERPPageHeader.js';
import Button from '../../../components/ui/Button.js';
import Badge from '../../../components/ui/Badge.js';
import { formatDate } from '../../../lib/format.js';

interface SchemaEntry {
  id: number;
  eventType: string;
  version: number;
  schema: Record<string, unknown>;
  compatibilityMode: string;
  description: string | null;
  registeredAt: string;
  registeredBy: number | null;
}

const COMPAT_VARIANT: Record<string, 'default' | 'success' | 'info' | 'warning'> = {
  BACKWARD: 'success',
  FORWARD: 'info',
  FULL: 'success',
  NONE: 'warning',
};

const COMPATIBILITY_MODES = ['BACKWARD', 'FORWARD', 'FULL', 'NONE'];

export default function SchemaRegistryPage() {
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [selectedSchema, setSelectedSchema] = useState<SchemaEntry | null>(null);
  const [showRegister, setShowRegister] = useState(false);
  const [form, setForm] = useState({ eventType: '', version: '1', schema: '{\n  "required": [],\n  "properties": {}\n}', compatibilityMode: 'BACKWARD', description: '' });
  const [checkPayload, setCheckPayload] = useState('');
  const [checkResult, setCheckResult] = useState<{ compatible: boolean; incompatibilities?: string[] } | null>(null);

  const { data: catalogData, isLoading } = useQuery({
    queryKey: ['schema-catalog'],
    queryFn: () => schemaRegistryApi.catalog(),
  });
  const schemas: SchemaEntry[] = (catalogData as unknown as SchemaEntry[]) ?? [];

  const registerMutation = useMutation({
    mutationFn: (entry: { eventType: string; schemaVersion: number; jsonSchema: Record<string, unknown>; compatibilityMode?: string; description?: string }) =>
      schemaRegistryApi.register(entry),
    onSuccess: () => {
      toast.success('Schema registered');
      setShowRegister(false);
      void qc.invalidateQueries({ queryKey: ['schema-catalog'] });
    },
    onError: (err: Error) => toast.error(err.message || 'Registration failed'),
  });

  const checkMutation = useMutation({
    mutationFn: ({ type, jsonSchema }: { type: string; jsonSchema: Record<string, unknown> }) =>
      schemaRegistryApi.check(type, { jsonSchema }),
    onSuccess: (result) => setCheckResult(result as { compatible: boolean; incompatibilities?: string[] }),
    onError: () => setCheckResult({ compatible: false, incompatibilities: ['Compatibility check failed'] }),
  });

  function handleRegister() {
    try {
      const jsonSchema = JSON.parse(form.schema) as Record<string, unknown>;
      const entry: Parameters<typeof registerMutation.mutate>[0] = {
        eventType: form.eventType,
        schemaVersion: parseInt(form.version, 10),
        jsonSchema,
        compatibilityMode: form.compatibilityMode,
      };
      if (form.description) entry.description = form.description;
      registerMutation.mutate(entry);
    } catch {
      toast.error('Invalid JSON schema');
    }
  }

  return (
    <div className="space-y-6">
      <ERPPageHeader
        variant="list"
        title="Schema Registry"
        subtitle="Manage event schema versions and compatibility"
        actions={hasPermission(PERMISSIONS.SCHEMA_REGISTRY_MANAGE) ? (
          <Button variant="primary" onClick={() => setShowRegister(true)}>Register Schema</Button>
        ) : undefined}
      />

      {/* Catalog table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-secondary">Loading schemas…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-surface-hover">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase">Event Type</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase">Version</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase">Compatibility</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase">Description</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase">Registered</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {schemas.map((s) => (
                <tr key={s.id} className="hover:bg-surface-hover">
                  <td className="px-4 py-3 font-medium text-primary">{s.eventType}</td>
                  <td className="px-4 py-3 text-secondary">v{s.version}</td>
                  <td className="px-4 py-3">
                    <Badge variant={COMPAT_VARIANT[s.compatibilityMode] ?? 'default'}>{s.compatibilityMode}</Badge>
                  </td>
                  <td className="px-4 py-3 text-secondary truncate max-w-[200px]">{s.description ?? '—'}</td>
                  <td className="px-4 py-3 text-secondary">{formatDate(s.registeredAt)}</td>
                  <td className="px-4 py-3">
                    <Button size="sm" variant="ghost" onClick={() => setSelectedSchema(s)}>View</Button>
                  </td>
                </tr>
              ))}
              {schemas.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-secondary">No schemas registered</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Schema detail modal */}
      {selectedSchema && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => { setSelectedSchema(null); setCheckResult(null); }}>
          <div className="bg-surface rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-primary">{selectedSchema.eventType} v{selectedSchema.version}</h3>
              <Badge variant={COMPAT_VARIANT[selectedSchema.compatibilityMode] ?? 'default'}>{selectedSchema.compatibilityMode}</Badge>
            </div>
            <pre className="bg-surface-hover rounded p-4 text-xs overflow-x-auto mb-4">{JSON.stringify(selectedSchema.schema, null, 2)}</pre>

            {hasPermission(PERMISSIONS.SCHEMA_REGISTRY_MANAGE) && (
              <div className="border-t border-border pt-4">
                <h4 className="text-sm font-semibold text-primary mb-2">Check Payload Compatibility</h4>
                <textarea
                  value={checkPayload}
                  onChange={(e) => setCheckPayload(e.target.value)}
                  rows={4}
                  placeholder='{"field": "value"}'
                  className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-primary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 mb-2"
                />
                {checkResult && (
                  <div className={`px-3 py-2 rounded-lg text-sm mb-2 ${checkResult.compatible ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
                    {checkResult.compatible ? 'Compatible' : `Incompatible: ${checkResult.incompatibilities?.join(', ')}`}
                  </div>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  loading={checkMutation.isPending}
                  onClick={() => {
                    try {
                      const jsonSchema = JSON.parse(checkPayload) as Record<string, unknown>;
                      checkMutation.mutate({ type: selectedSchema.eventType, jsonSchema });
                    } catch { toast.error('Invalid JSON'); }
                  }}
                >
                  Check
                </Button>
              </div>
            )}

            <Button variant="secondary" size="sm" className="mt-4" onClick={() => { setSelectedSchema(null); setCheckResult(null); }}>Close</Button>
          </div>
        </div>
      )}

      {/* Register modal */}
      {showRegister && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowRegister(false)}>
          <div className="bg-surface rounded-xl shadow-xl max-w-xl w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-primary mb-4">Register Schema</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-secondary mb-1">Event Type</label>
                <input
                  type="text"
                  value={form.eventType}
                  onChange={(e) => setForm((f) => ({ ...f, eventType: e.target.value }))}
                  placeholder="INVOICE_CONFIRMED"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1">Version</label>
                  <input
                    type="number"
                    min={1}
                    value={form.version}
                    onChange={(e) => setForm((f) => ({ ...f, version: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1">Compatibility</label>
                  <select
                    value={form.compatibilityMode}
                    onChange={(e) => setForm((f) => ({ ...f, compatibilityMode: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    {COMPATIBILITY_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-secondary mb-1">JSON Schema</label>
                <textarea
                  value={form.schema}
                  onChange={(e) => setForm((f) => ({ ...f, schema: e.target.value }))}
                  rows={6}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-primary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-secondary mb-1">Description</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Optional description"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button variant="primary" size="sm" loading={registerMutation.isPending} onClick={handleRegister} disabled={!form.eventType}>
                Register
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setShowRegister(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
