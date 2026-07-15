import { useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Zap,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  Search,
  RefreshCw,
  Truck,
} from 'lucide-react';
import { gstApi } from '../../api/endpoints.js';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';

type IrnStatus =
  | 'PENDING_IRN'
  | 'IRN_GENERATED'
  | 'IRN_CANCELLED'
  | 'FAILED_IRN'
  | 'NOT_APPLICABLE'
  | 'CANCEL_REQUIRED_MANUALLY';

const STATUS_CONFIG: Record<IrnStatus, { label: string; color: string; icon: ReactNode }> = {
  IRN_GENERATED: {
    label: 'IRN Generated',
    color: 'text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30',
    icon: <CheckCircle className="w-3.5 h-3.5" />,
  },
  PENDING_IRN: {
    label: 'Pending Retry',
    color: 'text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30',
    icon: <Clock className="w-3.5 h-3.5" />,
  },
  IRN_CANCELLED: {
    label: 'Cancelled',
    color: 'text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800',
    icon: <XCircle className="w-3.5 h-3.5" />,
  },
  FAILED_IRN: {
    label: 'Failed',
    color: 'text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-900/30',
    icon: <XCircle className="w-3.5 h-3.5" />,
  },
  NOT_APPLICABLE: {
    label: 'Not Applicable',
    color: 'text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800',
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
  },
  CANCEL_REQUIRED_MANUALLY: {
    label: 'Cancel via Portal',
    color: 'text-orange-700 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/30',
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
  },
};

function StatusBadge({ status }: { status: IrnStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.NOT_APPLICABLE;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cfg.color}`}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

interface EInvoiceListRow {
  invoiceId: number;
  invoiceNumber: string;
  irnStatus: IrnStatus;
  irn: string | null;
  ackNumber: string | null;
  signedQrCode: string | null;
  retryCount: number;
  failureReason: string | null;
  ewbNumber: string | null;
  ewbValidUpto: string | null;
  updatedAt: string;
}

function EInvoiceListTable() {
  const queryClient = useQueryClient();
  const canGenerateEInvoice = useAuthStore((s) => s.hasPermission(PERMISSIONS.EINVOICE_GENERATE));
  const { data, isLoading } = useQuery({
    queryKey: ['einvoice-list'],
    queryFn: () => gstApi.einvoiceList(),
    select: (r) => r.content as unknown as EInvoiceListRow[],
  });

  const retryMutation = useMutation({
    mutationFn: (invoiceId: number) => gstApi.retryIrn(invoiceId),
    onSuccess: () => {
      toast.success('IRN retry succeeded');
      void queryClient.invalidateQueries({ queryKey: ['einvoice-list'] });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'IRN retry failed';
      toast.error(message);
      void queryClient.invalidateQueries({ queryKey: ['einvoice-list'] });
    },
  });

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Recent e-Invoices</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Invoices for which IRN generation was attempted — auto-triggered on confirmation, or via
          manual retry
        </p>
      </div>

      {isLoading && <ERPTableSkeleton rows={4} cols={5} />}
      {!isLoading && (data?.length ?? 0) === 0 && (
        <ERPEmptyState
          type="no-data"
          title="No e-Invoice attempts recorded yet"
          description="IRN generation is triggered automatically when a B2B invoice is confirmed."
        />
      )}

      {!isLoading && (data?.length ?? 0) > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/50 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
              <tr>
                <th className="px-5 py-2.5">Invoice</th>
                <th className="px-5 py-2.5">IRN Status</th>
                <th className="px-5 py-2.5">IRN / QR</th>
                <th className="px-5 py-2.5">e-Way Bill</th>
                <th className="px-5 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {data?.map((row) => (
                <tr key={row.invoiceId}>
                  <td className="px-5 py-3 font-medium text-gray-900 dark:text-white">
                    {row.invoiceNumber}
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge status={row.irnStatus} />
                    {row.irnStatus === 'FAILED_IRN' && row.failureReason && (
                      <p
                        className="text-xs text-red-600 dark:text-red-400 mt-1 max-w-xs truncate"
                        title={row.failureReason}
                      >
                        {row.failureReason}
                      </p>
                    )}
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-gray-600 dark:text-gray-400">
                    {row.irn ? `${row.irn.substring(0, 20)}...` : '—'}
                    {row.signedQrCode && (
                      <span className="ml-2 inline-block text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400">
                        QR ready
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-600 dark:text-gray-400">
                    {row.ewbNumber ? (
                      <span className="inline-flex items-center gap-1">
                        <Truck className="w-3.5 h-3.5" /> {row.ewbNumber}
                      </span>
                    ) : (
                      'Not Generated'
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {canGenerateEInvoice &&
                      (row.irnStatus === 'FAILED_IRN' || row.irnStatus === 'PENDING_IRN') && (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => retryMutation.mutate(row.invoiceId)}
                          disabled={retryMutation.isPending}
                        >
                          <RefreshCw size={14} />
                          Retry
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

function InvoiceStatusLookup() {
  const [invoiceId, setInvoiceId] = useState('');
  const [searchId, setSearchId] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['einvoice-status', searchId],
    queryFn: () => gstApi.einvoiceStatus(searchId!),
    enabled: searchId !== null,
    select: (r) => r as Record<string, unknown>,
  });

  const handleSearch = () => {
    const id = parseInt(invoiceId, 10);
    if (!isNaN(id) && id > 0) setSearchId(id);
  };

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
        Check e-Invoice Status
      </h3>
      <div className="flex gap-3">
        <input
          type="number"
          value={invoiceId}
          onChange={(e) => setInvoiceId(e.target.value)}
          placeholder="Enter Invoice ID"
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          className="flex-1 px-3 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <Button variant="primary" onClick={handleSearch}>
          <Search size={16} />
          Lookup
        </Button>
      </div>

      {isLoading && (
        <p className="mt-4 text-sm text-gray-400 dark:text-gray-500">Fetching status...</p>
      )}
      {error && (
        <p className="mt-4 text-sm text-red-600 dark:text-red-400">
          Invoice not found or error fetching status
        </p>
      )}

      {data && (
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600 dark:text-gray-400">Status</span>
            <StatusBadge status={(data.irnStatus as IrnStatus) ?? 'NOT_APPLICABLE'} />
          </div>
          {Boolean(data.irn) && (
            <div>
              <span className="text-xs text-gray-500 dark:text-gray-400">IRN</span>
              <p className="text-xs font-mono text-gray-700 dark:text-gray-300 break-all mt-0.5">
                {String(data.irn)}
              </p>
            </div>
          )}
          {Boolean(data.ackNumber) && (
            <div className="flex justify-between">
              <span className="text-sm text-gray-600 dark:text-gray-400">Ack No</span>
              <span className="text-sm font-medium text-gray-900 dark:text-white font-mono">
                {String(data.ackNumber)}
              </span>
            </div>
          )}
          {Boolean(data.ackDate) && (
            <div className="flex justify-between">
              <span className="text-sm text-gray-600 dark:text-gray-400">Ack Date</span>
              <span className="text-sm text-gray-700 dark:text-gray-300">
                {String(data.ackDate)}
              </span>
            </div>
          )}
          {Boolean(data.ewbNumber) && (
            <div className="mt-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
              <p className="text-xs font-medium text-blue-700 dark:text-blue-400">e-Way Bill</p>
              <p className="text-sm font-mono text-blue-800 dark:text-blue-300 mt-1">
                {String(data.ewbNumber)}
              </p>
              {Boolean(data.ewbValidUpto) && (
                <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                  Valid until: {String(data.ewbValidUpto)}
                </p>
              )}
            </div>
          )}
          {Boolean(data.signedQrCode) && (
            <div>
              <span className="text-xs text-gray-500 dark:text-gray-400">Signed QR</span>
              <p className="text-xs font-mono text-gray-500 dark:text-gray-500 truncate mt-0.5">
                {String(data.signedQrCode).substring(0, 40)}...
              </p>
            </div>
          )}
          {data.retryCount !== undefined && Number(data.retryCount) > 0 && (
            <div className="flex justify-between">
              <span className="text-sm text-gray-600 dark:text-gray-400">Retry Attempts</span>
              <span className="text-sm text-amber-600 dark:text-amber-400">
                {String(data.retryCount)} / 5
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function EInvoicePage() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Zap className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">e-Invoice (IRN)</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            NIC IRP portal integration — IRN generation, cancellation &amp; e-Way Bill
          </p>
        </div>
      </div>

      {/* Info card */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
          <div className="text-xs font-medium text-blue-600 dark:text-blue-400 uppercase mb-1">
            Threshold
          </div>
          <div className="text-lg font-semibold text-blue-800 dark:text-blue-300">₹5 Lakh</div>
          <div className="text-xs text-blue-600 dark:text-blue-500 mt-1">
            e-Invoice mandatory above this
          </div>
        </div>
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4">
          <div className="text-xs font-medium text-green-600 dark:text-green-400 uppercase mb-1">
            e-Way Bill
          </div>
          <div className="text-lg font-semibold text-green-800 dark:text-green-300">₹50K+</div>
          <div className="text-xs text-green-600 dark:text-green-500 mt-1">
            EWB required for goods in transit
          </div>
        </div>
        <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-xl p-4">
          <div className="text-xs font-medium text-purple-600 dark:text-purple-400 uppercase mb-1">
            Cancellation
          </div>
          <div className="text-lg font-semibold text-purple-800 dark:text-purple-300">24 Hours</div>
          <div className="text-xs text-purple-600 dark:text-purple-500 mt-1">
            IRN can be cancelled within 24h
          </div>
        </div>
      </div>

      {/* Recent e-Invoice attempts */}
      <EInvoiceListTable />

      {/* Status lookup */}
      <InvoiceStatusLookup />

      {/* Instructions */}
      <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
          How IRN Generation Works
        </h3>
        <ol className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
          <li className="flex gap-2">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-medium">
              1
            </span>
            Confirming a B2B invoice (customer GSTIN on file) auto-triggers IRN generation via NIC
          </li>
          <li className="flex gap-2">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-medium">
              2
            </span>
            IRN, Ack No, and signed QR code are stored automatically on success
          </li>
          <li className="flex gap-2">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-medium">
              3
            </span>
            Transient NIC failures retry automatically (3x on the call, then every 15 min)
          </li>
          <li className="flex gap-2">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-medium">
              4
            </span>
            Use "Retry" on a Failed row above to force an immediate retry
          </li>
          <li className="flex gap-2">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-medium">
              5
            </span>
            Generate e-Way Bill from the invoice detail page if goods value &gt; ₹50K
          </li>
        </ol>
      </div>

      {/* Status legend */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
          Status Reference
        </h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {(Object.entries(STATUS_CONFIG) as [IrnStatus, (typeof STATUS_CONFIG)[IrnStatus]][]).map(
            ([status]) => (
              <div key={status} className="flex flex-col items-start gap-1.5">
                <StatusBadge status={status} />
                <p className="text-xs text-gray-500 dark:text-gray-400 leading-tight">
                  {status === 'IRN_GENERATED' && 'Successfully registered with NIC IRP'}
                  {status === 'PENDING_IRN' && 'Network timeout; auto-retry pending'}
                  {status === 'IRN_CANCELLED' && 'Cancelled at NIC portal'}
                  {status === 'FAILED_IRN' && 'Max retries exceeded or invalid data'}
                  {status === 'NOT_APPLICABLE' && 'Below ₹5L threshold'}
                  {status === 'CANCEL_REQUIRED_MANUALLY' &&
                    '24h window passed; cancel via NIC portal'}
                </p>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
