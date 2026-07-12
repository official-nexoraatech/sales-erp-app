import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminSecurityApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import { formatDate } from '../../lib/format.js';

interface AuditLogRow {
  id: string;
  action: string;
  actorId: number;
  actorRole: string | null;
  targetUserId: number | null;
  ipAddress: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

const ACTION_TYPES = [
  '',
  'IMPERSONATION_START',
  'IMPERSONATION_END',
  'MFA_ENABLED',
  'MFA_DISABLED',
  'SESSION_TERMINATED',
  'SUSPICIOUS_LOGIN',
];

export default function SecurityAuditLogPage() {
  const [page, setPage] = useState(0);
  const [action, setAction] = useState('');
  const size = 20;

  const { data, isLoading } = useQuery({
    queryKey: ['security-audit-log', page, action],
    queryFn: () => adminSecurityApi.auditLog({ page, size, ...(action ? { action } : {}) }),
  });

  const result = data as unknown as { content: AuditLogRow[]; totalElements: number } | undefined;
  const rows = result?.content ?? [];
  const totalElements = result?.totalElements ?? 0;

  return (
    <div className="space-y-6">
      <ERPPageHeader
        variant="list"
        title="Security Audit Log"
        subtitle="Impersonation, 2FA, session, and suspicious login events."
      />

      <div className="card p-4">
        <label className="block text-xs font-medium text-secondary mb-1">Action Type</label>
        <select
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(0);
          }}
          className="w-64 px-3 py-2 rounded-lg border border-border bg-surface text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          {ACTION_TYPES.map((t) => (
            <option key={t} value={t}>
              {t || 'All Actions'}
            </option>
          ))}
        </select>
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <ERPTableSkeleton rows={8} cols={6} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-hover">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase">
                    Action
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase">
                    Actor
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase">
                    Target
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase">
                    IP
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase">
                    Timestamp
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase">
                    Details
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-surface-hover">
                    <td className="px-4 py-3 font-medium text-primary">{row.action}</td>
                    <td className="px-4 py-3 text-secondary">
                      {row.actorId}
                      {row.actorRole ? ` (${row.actorRole})` : ''}
                    </td>
                    <td className="px-4 py-3 text-secondary">{row.targetUserId ?? '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-secondary">
                      {row.ipAddress ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-secondary">{formatDate(row.createdAt)}</td>
                    <td className="px-4 py-3 text-secondary text-xs truncate max-w-[200px]">
                      {row.details ? JSON.stringify(row.details) : '—'}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6}>
                      <ERPEmptyState
                        type="no-results"
                        title="No audit log entries"
                        description="Try adjusting the action filter."
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
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
