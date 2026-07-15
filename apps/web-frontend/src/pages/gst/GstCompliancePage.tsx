import { useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Calendar, CheckCircle, AlertTriangle, Clock, TrendingUp, Truck } from 'lucide-react';
import { gstApi } from '../../api/endpoints.js';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';

function getCurrentFy(): string {
  const now = new Date();
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const shortNext = String(year + 1).slice(2);
  return `${year}-${shortNext}`;
}

type FilingStatus = 'PENDING' | 'FILED' | 'LATE_FILED' | 'NOT_DUE';

const STATUS_CONFIG: Record<FilingStatus, { label: string; color: string; icon: ReactNode }> = {
  FILED: {
    label: 'Filed',
    color: 'text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30',
    icon: <CheckCircle className="w-3.5 h-3.5" />,
  },
  LATE_FILED: {
    label: 'Late Filed',
    color: 'text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30',
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
  },
  PENDING: {
    label: 'Pending',
    color: 'text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-900/30',
    icon: <Clock className="w-3.5 h-3.5" />,
  },
  NOT_DUE: {
    label: 'Not Due',
    color: 'text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800',
    icon: <Clock className="w-3.5 h-3.5" />,
  },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status as FilingStatus] ?? STATUS_CONFIG.PENDING;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}
    >
      {cfg.icon} {cfg.label}
    </span>
  );
}

function MarkFiledModal({
  entry,
  onClose,
}: {
  entry: Record<string, unknown>;
  onClose: () => void;
}) {
  const [refNo, setRefNo] = useState('');
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      gstApi.markFiled(
        String(entry.returnType ?? ''),
        String(entry.period ?? ''),
        refNo || undefined
      ),
    onSuccess: () => {
      toast.success(`${String(entry.returnType)} marked as filed`);
      void qc.invalidateQueries({ queryKey: ['gst-returns-calendar'] });
      void qc.invalidateQueries({ queryKey: ['gst-returns-status'] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
          Mark {String(entry.returnType)} as Filed — {String(entry.period)}
        </h2>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Reference Number (optional)
            </label>
            <input
              type="text"
              value={refNo}
              onChange={(e) => setRefNo(e.target.value)}
              placeholder="ARN or acknowledgement number"
              className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => mutation.mutate()}
              loading={mutation.isPending}
            >
              Confirm Filed
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function GstCompliancePage() {
  const canFileGst = useAuthStore((s) => s.hasPermission(PERMISSIONS.GST_FILE));
  const [fy, setFy] = useState(getCurrentFy());
  const [markingEntry, setMarkingEntry] = useState<Record<string, unknown> | null>(null);

  const { data: calendarData, isLoading: calLoading } = useQuery({
    queryKey: ['gst-returns-calendar', fy],
    queryFn: () => gstApi.returnsCalendar(fy),
  });

  const { data: statusData } = useQuery({
    queryKey: ['gst-returns-status'],
    queryFn: () => gstApi.returnsStatus(),
  });

  const { data: ewbData } = useQuery({
    queryKey: ['ewb-expiring'],
    queryFn: () => gstApi.ewbExpiringSoon(),
  });

  const calendar =
    (calendarData as { calendar?: Record<string, unknown>[] } | undefined)?.calendar ?? [];

  const gstr1Entries = calendar.filter((e) => e.returnType === 'GSTR1');
  const gstr3bEntries = calendar.filter((e) => e.returnType === 'GSTR3B');

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Calendar className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
            GST Compliance Calendar
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Return filing tracker &amp; e-Way Bill monitoring
          </p>
        </div>
      </div>

      {/* Status summary */}
      {statusData && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[
            {
              key: 'pendingCount',
              label: 'Pending Returns',
              color: 'text-amber-600 dark:text-amber-400',
              icon: <Clock className="w-5 h-5" />,
            },
            {
              key: 'overdueCount',
              label: 'Overdue',
              color: 'text-red-600 dark:text-red-400',
              icon: <AlertTriangle className="w-5 h-5" />,
            },
            {
              key: 'filedThisMonth',
              label: 'Filed This Month',
              color: 'text-green-600 dark:text-green-400',
              icon: <CheckCircle className="w-5 h-5" />,
            },
            {
              key: 'nextDue',
              label: 'Next Due',
              color: 'text-indigo-600 dark:text-indigo-400',
              icon: <TrendingUp className="w-5 h-5" />,
            },
          ].map(({ key, label, color, icon }) => (
            <div
              key={key}
              className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4"
            >
              <div className={`flex items-center gap-2 mb-2 ${color}`}>
                {icon}
                <span className="text-xs">{label}</span>
              </div>
              <div
                className={`text-lg font-semibold ${key === 'nextDue' ? 'text-sm font-medium' : ''} ${color}`}
              >
                {key === 'nextDue' && statusData[key]
                  ? `${String((statusData[key] as Record<string, unknown>)?.returnType ?? '')} by ${String((statusData[key] as Record<string, unknown>)?.dueDate ?? '')}`
                  : String(statusData[key] ?? 0)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* FY Selector */}
      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
          Financial Year
        </label>
        <input
          type="text"
          value={fy}
          onChange={(e) => setFy(e.target.value)}
          placeholder="2025-26"
          pattern="\d{4}-\d{2}"
          className="px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 w-36"
        />
      </div>

      {/* Calendar grid */}
      {calLoading ? (
        <ERPTableSkeleton rows={6} cols={5} />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {[
            { label: 'GSTR-1 (11th of following month)', entries: gstr1Entries },
            { label: 'GSTR-3B (20th of following month)', entries: gstr3bEntries },
          ].map(({ label, entries }) => (
            <div
              key={label}
              className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl"
            >
              <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{label}</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead className="bg-gray-50 dark:bg-gray-900/30">
                    <tr>
                      {['Period', 'Due Date', 'Status', 'Filed On', 'Action'].map((h) => (
                        <th
                          key={h}
                          className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {entries.length === 0 ? (
                      <tr>
                        <td colSpan={5}>
                          <ERPEmptyState
                            type="no-results"
                            title="No entries"
                            description="No filing entries for this financial year."
                          />
                        </td>
                      </tr>
                    ) : (
                      entries.map((e, i) => (
                        <tr
                          key={i}
                          className={`${e.isOverdue ? 'bg-red-50/30 dark:bg-red-900/5' : ''} hover:bg-gray-50 dark:hover:bg-gray-700/30`}
                        >
                          <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 font-medium">
                            {String(e.period ?? '')}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
                            {String(e.dueDate ?? '')}
                            {Boolean(e.isOverdue) && (
                              <span className="ml-1 text-xs text-red-600 dark:text-red-400">
                                ({String(e.daysOverdue ?? 0)}d late)
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge status={String(e.status ?? 'PENDING')} />
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                            {e.filedAt ? String(e.filedAt).substring(0, 10) : '—'}
                          </td>
                          <td className="px-4 py-3">
                            {canFileGst && (e.status === 'PENDING' || e.status === 'OVERDUE') && (
                              <Button variant="link" onClick={() => setMarkingEntry(e)}>
                                Mark Filed
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* e-Way Bill expiry alert */}
      {ewbData && ewbData.totalElements > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <Truck className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              {ewbData.totalElements} e-Way Bill{ewbData.totalElements > 1 ? 's' : ''} Expiring
              Within 24 Hours
            </h3>
          </div>
          <div className="space-y-2">
            {(ewbData.content as Record<string, unknown>[]).map((e, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-amber-700 dark:text-amber-400 font-mono">
                  EWB: {String(e.ewbNumber ?? '')}
                </span>
                <span className="text-amber-600 dark:text-amber-500">
                  Expires: {String(e.ewbValidUpto ?? '')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {markingEntry && (
        <MarkFiledModal entry={markingEntry} onClose={() => setMarkingEntry(null)} />
      )}
    </div>
  );
}
