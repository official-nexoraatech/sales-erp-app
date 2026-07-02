import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Zap, CheckCircle, XCircle, Clock, AlertTriangle, Search, X } from 'lucide-react';
import { gstApi } from '../../api/endpoints.js';

const STUB_BANNER_KEY = 'einvoice_stub_banner_dismissed';

// Remove this banner when NIC integration is live (see ES-11)
function StubWarningBanner() {
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem(STUB_BANNER_KEY) === 'true'
  );

  if (dismissed) return null;

  const handleDismiss = () => {
    sessionStorage.setItem(STUB_BANNER_KEY, 'true');
    setDismissed(true);
  };

  return (
    <div className="flex items-start gap-3 w-full rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-4 py-3">
      <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
      <p className="flex-1 text-sm text-amber-800 dark:text-amber-300 font-medium">
        ⚠ STUB MODE: e-Invoice and e-Way Bill are not connected to the NIC portal. IRN numbers generated here are test values only. Do not use for real invoices.
      </p>
      <button
        onClick={handleDismiss}
        aria-label="Dismiss warning"
        className="shrink-0 text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

type IrnStatus = 'PENDING_IRN' | 'IRN_GENERATED' | 'IRN_CANCELLED' | 'FAILED_IRN' | 'NOT_APPLICABLE';

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
    color: 'text-gray-400 bg-gray-100 dark:bg-gray-800',
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
  },
};

function StatusBadge({ status }: { status: IrnStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.NOT_APPLICABLE;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cfg.color}`}>
      {cfg.icon}
      {cfg.label}
    </span>
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
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Check e-Invoice Status</h3>
      <div className="flex gap-3">
        <input
          type="number"
          value={invoiceId}
          onChange={(e) => setInvoiceId(e.target.value)}
          placeholder="Enter Invoice ID"
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          className="flex-1 px-3 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          onClick={handleSearch}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
        >
          <Search className="w-4 h-4" />
          Lookup
        </button>
      </div>

      {isLoading && <p className="mt-4 text-sm text-gray-400">Fetching status...</p>}
      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">Invoice not found or error fetching status</p>}

      {data && (
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600 dark:text-gray-400">Status</span>
            <StatusBadge status={(data.irnStatus as IrnStatus) ?? 'NOT_APPLICABLE'} />
          </div>
          {Boolean(data.irn) && (
            <div>
              <span className="text-xs text-gray-500 dark:text-gray-400">IRN</span>
              <p className="text-xs font-mono text-gray-700 dark:text-gray-300 break-all mt-0.5">{String(data.irn)}</p>
            </div>
          )}
          {Boolean(data.ackNumber) && (
            <div className="flex justify-between">
              <span className="text-sm text-gray-600 dark:text-gray-400">Ack No</span>
              <span className="text-sm font-medium text-gray-900 dark:text-white font-mono">{String(data.ackNumber)}</span>
            </div>
          )}
          {Boolean(data.ackDate) && (
            <div className="flex justify-between">
              <span className="text-sm text-gray-600 dark:text-gray-400">Ack Date</span>
              <span className="text-sm text-gray-700 dark:text-gray-300">{String(data.ackDate)}</span>
            </div>
          )}
          {Boolean(data.ewbNumber) && (
            <div className="mt-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
              <p className="text-xs font-medium text-blue-700 dark:text-blue-400">e-Way Bill</p>
              <p className="text-sm font-mono text-blue-800 dark:text-blue-300 mt-1">{String(data.ewbNumber)}</p>
              {Boolean(data.ewbValidUpto) && (
                <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">Valid until: {String(data.ewbValidUpto)}</p>
              )}
            </div>
          )}
          {Boolean(data.signedQrCode) && (
            <div>
              <span className="text-xs text-gray-500 dark:text-gray-400">Signed QR</span>
              <p className="text-xs font-mono text-gray-500 dark:text-gray-500 truncate mt-0.5">{String(data.signedQrCode).substring(0, 40)}...</p>
            </div>
          )}
          {data.retryCount !== undefined && Number(data.retryCount) > 0 && (
            <div className="flex justify-between">
              <span className="text-sm text-gray-600 dark:text-gray-400">Retry Attempts</span>
              <span className="text-sm text-amber-600 dark:text-amber-400">{String(data.retryCount)} / 5</span>
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
      <StubWarningBanner />

      <div className="flex items-center gap-3">
        <Zap className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">e-Invoice (IRN)</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">NIC IRP portal integration — IRN generation, cancellation &amp; e-Way Bill</p>
        </div>
      </div>

      {/* Info card */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
          <div className="text-xs font-medium text-blue-600 dark:text-blue-400 uppercase mb-1">Threshold</div>
          <div className="text-lg font-semibold text-blue-800 dark:text-blue-300">₹5 Lakh</div>
          <div className="text-xs text-blue-600 dark:text-blue-500 mt-1">e-Invoice mandatory above this</div>
        </div>
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4">
          <div className="text-xs font-medium text-green-600 dark:text-green-400 uppercase mb-1">e-Way Bill</div>
          <div className="text-lg font-semibold text-green-800 dark:text-green-300">₹50K+</div>
          <div className="text-xs text-green-600 dark:text-green-500 mt-1">EWB required for goods in transit</div>
        </div>
        <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-xl p-4">
          <div className="text-xs font-medium text-purple-600 dark:text-purple-400 uppercase mb-1">Cancellation</div>
          <div className="text-lg font-semibold text-purple-800 dark:text-purple-300">24 Hours</div>
          <div className="text-xs text-purple-600 dark:text-purple-500 mt-1">IRN can be cancelled within 24h</div>
        </div>
      </div>

      {/* Status lookup */}
      <InvoiceStatusLookup />

      {/* Instructions */}
      <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">How to Generate IRN</h3>
        <ol className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
          <li className="flex gap-2"><span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-medium">1</span>Confirm the invoice in the Sales module</li>
          <li className="flex gap-2"><span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-medium">2</span>Open the invoice detail page</li>
          <li className="flex gap-2"><span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-medium">3</span>Click "Generate IRN" — the NIC payload will be pre-filled</li>
          <li className="flex gap-2"><span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-medium">4</span>IRN, Ack No, and signed QR code are stored automatically</li>
          <li className="flex gap-2"><span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-medium">5</span>Generate e-Way Bill from the same page if goods value &gt; ₹50K</li>
        </ol>
      </div>

      {/* Status legend */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Status Reference</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {(Object.entries(STATUS_CONFIG) as [IrnStatus, typeof STATUS_CONFIG[IrnStatus]][]).map(([status]) => (
            <div key={status} className="flex flex-col items-start gap-1.5">
              <StatusBadge status={status} />
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-tight">
                {status === 'IRN_GENERATED' && 'Successfully registered with NIC IRP'}
                {status === 'PENDING_IRN' && 'Network timeout; auto-retry pending'}
                {status === 'IRN_CANCELLED' && 'Cancelled at NIC portal'}
                {status === 'FAILED_IRN' && 'Max retries exceeded or invalid data'}
                {status === 'NOT_APPLICABLE' && 'Below ₹5L threshold'}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
