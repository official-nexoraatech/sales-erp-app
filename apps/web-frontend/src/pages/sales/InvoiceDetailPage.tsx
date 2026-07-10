import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { invoiceApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPDetailSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import AttachmentSection from '../../components/erp/AttachmentSection.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Modal from '../../components/ui/Modal.js';
import Input from '../../components/ui/Input.js';
import { formatDate, formatDatetime, formatCurrency } from '../../lib/format.js';

interface InvoiceLine {
  id: number;
  itemId: number;
  quantity: string;
  unitPrice: string;
  taxableAmount: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  lineTotal: string;
  hsnCode?: string;
}

interface InvoiceDetail {
  id: number;
  invoiceNumber: string | null;
  status: string;
  customerId: number;
  invoiceDate: string;
  dueDate: string;
  subtotal: string;
  taxableAmount: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  grandTotal: string;
  balanceDue: string;
  paidAmount: string;
  notes?: string;
  lines: InvoiceLine[];
}

const STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'default', CONFIRMED: 'success', PARTIALLY_PAID: 'warning', PAID: 'success', CANCELLED: 'danger', OVERDUE: 'danger',
};

function openPdfInNewTab(blob: Blob) {
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  // Revoke after the new tab has had time to load the object URL, not immediately.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreateInvoice = hasPermission(PERMISSIONS.INVOICE_CREATE);
  const canCreatePayment = hasPermission(PERMISSIONS.PAYMENT_CREATE);
  const canCancelInvoice = hasPermission(PERMISSIONS.INVOICE_CANCEL);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [invoiceNum, setInvoiceNum] = useState('');
  const [cancelReason, setCancelReason] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => invoiceApi.getById(Number(id)),
    enabled: !!id,
  });

  const invoice = (data as InvoiceDetail);

  const confirmMutation = useMutation({
    mutationFn: () => invoiceApi.confirm(Number(id), { invoiceNumber: invoiceNum }),
    onSuccess: () => { toast.success('Invoice confirmed'); qc.invalidateQueries({ queryKey: ['invoice', id] }); setShowConfirm(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelMutation = useMutation({
    mutationFn: () => invoiceApi.cancel(Number(id), { reason: cancelReason }),
    onSuccess: () => { toast.success('Invoice cancelled'); qc.invalidateQueries({ queryKey: ['invoice', id] }); setShowCancel(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  const pdfMutation = useMutation({
    mutationFn: () => invoiceApi.pdf(Number(id)),
    onSuccess: (blob) => openPdfInNewTab(blob as Blob),
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <ERPDetailSkeleton />;
  if (!invoice) return <ERPEmptyState type="no-data" title="Invoice not found" />;

  return (
    <div>
      <ERPPageHeader variant="list" title={invoice.invoiceNumber ?? 'Draft Invoice'} subtitle={`Customer ${invoice.customerId}`}>
        <div className="flex items-center gap-3">
          <Badge variant={STATUS_COLORS[invoice.status] ?? 'default'}>{invoice.status}</Badge>
          {canCreateInvoice && invoice.status === 'DRAFT' && (
            <Button onClick={() => setShowConfirm(true)}>Confirm Invoice</Button>
          )}
          {canCreatePayment && ['CONFIRMED', 'PARTIALLY_PAID'].includes(invoice.status) && (
            <Button onClick={() => navigate(`/sales/payments/new?invoiceId=${id}`)} variant="ghost">Record Payment</Button>
          )}
          {['CONFIRMED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'].includes(invoice.status) && (
            <Button variant="ghost" isLoading={pdfMutation.isPending} onClick={() => pdfMutation.mutate()}>
              Print / Download PDF
            </Button>
          )}
          {canCancelInvoice && ['DRAFT', 'CONFIRMED'].includes(invoice.status) && (
            <Button variant="danger" onClick={() => setShowCancel(true)}>Cancel</Button>
          )}
        </div>
      </ERPPageHeader>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Invoice Date', value: formatDate(invoice.invoiceDate) },
          { label: 'Due Date', value: formatDate(invoice.dueDate) },
          { label: 'Grand Total', value: formatCurrency(parseFloat(invoice.grandTotal)) },
          { label: 'Balance Due', value: formatCurrency(parseFloat(invoice.balanceDue)) },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
            <div className="text-lg font-semibold mt-1">{value}</div>
          </div>
        ))}
      </div>

      {/* Line Items */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4">
        <h3 className="font-semibold mb-3">Line Items</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
              <th className="pb-2">Item</th>
              <th className="pb-2">HSN</th>
              <th className="pb-2">Qty</th>
              <th className="pb-2">Price</th>
              <th className="pb-2">Taxable</th>
              <th className="pb-2">CGST</th>
              <th className="pb-2">SGST</th>
              <th className="pb-2">IGST</th>
              <th className="pb-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y dark:divide-gray-700">
            {invoice.lines.map((l) => (
              <tr key={l.id}>
                <td className="py-2">{l.itemId}</td>
                <td className="py-2 text-secondary">{l.hsnCode ?? '—'}</td>
                <td className="py-2">{parseFloat(l.quantity).toFixed(3)}</td>
                <td className="py-2">₹{parseFloat(l.unitPrice).toFixed(2)}</td>
                <td className="py-2">₹{parseFloat(l.taxableAmount).toFixed(2)}</td>
                <td className="py-2">₹{parseFloat(l.cgstAmount).toFixed(2)}</td>
                <td className="py-2">₹{parseFloat(l.sgstAmount).toFixed(2)}</td>
                <td className="py-2">₹{parseFloat(l.igstAmount).toFixed(2)}</td>
                <td className="py-2 text-right font-semibold">₹{parseFloat(l.lineTotal).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 pt-4 border-t dark:border-gray-700 flex justify-end">
          <div className="w-64 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-secondary">Taxable</span><span>₹{parseFloat(invoice.taxableAmount).toFixed(2)}</span></div>
            {parseFloat(invoice.cgstAmount) > 0 && <div className="flex justify-between"><span className="text-secondary">CGST</span><span>₹{parseFloat(invoice.cgstAmount).toFixed(2)}</span></div>}
            {parseFloat(invoice.sgstAmount) > 0 && <div className="flex justify-between"><span className="text-secondary">SGST</span><span>₹{parseFloat(invoice.sgstAmount).toFixed(2)}</span></div>}
            {parseFloat(invoice.igstAmount) > 0 && <div className="flex justify-between"><span className="text-secondary">IGST</span><span>₹{parseFloat(invoice.igstAmount).toFixed(2)}</span></div>}
            <div className="flex justify-between font-bold text-base pt-1 border-t dark:border-gray-700">
              <span>Grand Total</span><span>₹{parseFloat(invoice.grandTotal).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-success"><span>Paid</span><span>₹{parseFloat(invoice.paidAmount).toFixed(2)}</span></div>
            <div className="flex justify-between font-semibold text-danger"><span>Balance Due</span><span>₹{parseFloat(invoice.balanceDue).toFixed(2)}</span></div>
          </div>
        </div>
      </div>

      {invoice.notes && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4">
          <h3 className="font-semibold mb-1 text-sm">Notes</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">{invoice.notes}</p>
        </div>
      )}

      <div className="mb-4">
        <AttachmentSection service="sales" entityType="INVOICE" entityId={invoice.id} />
      </div>

      {/* Confirm Modal */}
      <Modal isOpen={showConfirm} onClose={() => setShowConfirm(false)} title="Confirm Invoice">
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Confirming will deduct stock and assign an invoice number. This cannot be undone easily.
          </p>
          <Input
            label="Invoice Number"
            value={invoiceNum}
            onChange={(e) => setInvoiceNum(e.target.value)}
            placeholder="INV-2026-001"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowConfirm(false)}>Cancel</Button>
            <Button isLoading={confirmMutation.isPending} onClick={() => confirmMutation.mutate()} disabled={!invoiceNum}>
              Confirm Invoice
            </Button>
          </div>
        </div>
      </Modal>

      {/* Cancel Modal */}
      <Modal isOpen={showCancel} onClose={() => setShowCancel(false)} title="Cancel Invoice">
        <div className="space-y-4">
          <Input
            label="Cancellation Reason"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="Reason for cancellation..."
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowCancel(false)}>Back</Button>
            <Button variant="danger" isLoading={cancelMutation.isPending} onClick={() => cancelMutation.mutate()} disabled={!cancelReason}>
              Cancel Invoice
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
