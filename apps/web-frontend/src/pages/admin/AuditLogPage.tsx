import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { auditLogApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import { formatDate } from '../../lib/format.js';

interface AuditLogRow {
  id: number;
  action: string;
  entityType: string;
  entityId: number | null;
  beforeData: Record<string, unknown> | null;
  afterData: Record<string, unknown> | null;
  changedFields: string[] | null;
  actorEmail: string | null;
  ipAddress: string | null;
  createdAt: string;
}

const ENTITY_TYPES = ['', 'invoice', 'sales_return', 'customer', 'item'];

export default function AuditLogPage() {
  const [page, setPage] = useState(0);
  const [entity, setEntity] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const size = 20;

  const { data, isLoading } = useQuery({
    queryKey: ['audit-log', page, entity],
    queryFn: () => auditLogApi.list({ page: page + 1, limit: size, ...(entity ? { entity } : {}) }),
  });

  const result = data as unknown as { content: AuditLogRow[]; totalElements: number } | undefined;
  const rows = result?.content ?? [];
  const totalElements = result?.totalElements ?? 0;

  return (
    <div className="space-y-6">
      <ERPPageHeader variant="list" title="Audit Log" subtitle="Who changed what, when, across business entities." />

      <div className="card p-4">
        <label className="block text-xs font-medium text-secondary mb-1">Entity Type</label>
        <select
          value={entity}
          onChange={(e) => {
            setEntity(e.target.value);
            setPage(0);
          }}
          className="w-64 px-3 py-2 rounded-lg border border-border bg-surface text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          {ENTITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t || 'All Entities'}
            </option>
          ))}
        </select>
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <ERPTableSkeleton rows={8} cols={6} />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-surface-hover">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase"></th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase">Time</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase">Entity</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase">Action</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase">Actor</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase">Changed Fields</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <Fragment key={row.id}>
                  <tr
                    className="hover:bg-surface-hover cursor-pointer"
                    onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                  >
                    <td className="px-4 py-3 text-secondary">
                      {expandedId === row.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </td>
                    <td className="px-4 py-3 text-secondary">{formatDate(row.createdAt)}</td>
                    <td className="px-4 py-3 text-primary font-medium">
                      {row.entityType}
                      {row.entityId ? ` #${row.entityId}` : ''}
                    </td>
                    <td className="px-4 py-3 text-secondary">{row.action}</td>
                    <td className="px-4 py-3 text-secondary">{row.actorEmail ?? '—'}</td>
                    <td className="px-4 py-3 text-secondary text-xs truncate max-w-[200px]">
                      {row.changedFields?.length ? row.changedFields.join(', ') : '—'}
                    </td>
                  </tr>
                  {expandedId === row.id && (
                    <tr className="bg-surface-hover">
                      <td colSpan={6} className="px-4 py-3">
                        <div className="grid grid-cols-2 gap-4 text-xs">
                          <div>
                            <div className="font-semibold text-secondary mb-1">Before</div>
                            <pre className="bg-surface-card border border-default rounded-lg p-2 overflow-x-auto">
                              {row.beforeData ? JSON.stringify(row.beforeData, null, 2) : '—'}
                            </pre>
                          </div>
                          <div>
                            <div className="font-semibold text-secondary mb-1">After</div>
                            <pre className="bg-surface-card border border-default rounded-lg p-2 overflow-x-auto">
                              {row.afterData ? JSON.stringify(row.afterData, null, 2) : '—'}
                            </pre>
                          </div>
                        </div>
                        {row.ipAddress && (
                          <div className="mt-2 text-xs text-secondary">IP: {row.ipAddress}</div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <ERPEmptyState type="no-results" title="No audit log entries" description="Try adjusting the entity filter." />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {totalElements > size && (
        <div className="flex items-center justify-between text-sm text-secondary">
          <span>
            Page {page + 1} of {Math.ceil(totalElements / size)}
          </span>
          <div className="flex gap-2">
            <button
              className="px-3 py-1.5 rounded-lg border border-default disabled:opacity-50"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Previous
            </button>
            <button
              className="px-3 py-1.5 rounded-lg border border-default disabled:opacity-50"
              disabled={(page + 1) * size >= totalElements}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
