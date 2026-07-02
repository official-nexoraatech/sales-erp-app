import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { quotationApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPDetailSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import ERPConfirmModal from '../../components/erp/ERPConfirmModal.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import { formatDate, formatCurrency } from '../../lib/format.js';
import { useState } from 'react';

interface QuotationLine {
  id: number;
  itemId: number;
  description?: string;
  quantity: string;
  unitPrice: string;
  taxableAmount: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  lineTotal: string;
  hsnCode?: string;
  gstRate: string;
}

interface QuotationDetail {
  id: number;
  quotationNumber: string;
  customerId: number;
  status: string;
  validUntil: string;
  createdAt: string;
  placeOfSupply: string;
  subtotal: string;
  discountAmount: string;
  taxableAmount: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  grandTotal: string;
  notes?: string;
  termsAndConditions?: string;
  lines: QuotationLine[];
}

const STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'default',
  SENT: 'warning',
  VIEWED: 'warning',
  ACCEPTED: 'success',
  CONVERTED: 'success',
  EXPIRED: 'danger',
  REJECTED: 'danger',
};

export default function QuotationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showConvertConfirm, setShowConvertConfirm] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['quotation', id],
    queryFn: () => quotationApi.getById(Number(id)),
    enabled: !!id,
  });

  const q = (data as { data?: QuotationDetail })?.data;

  const sendMutation = useMutation({
    mutationFn: () => quotationApi.send(Number(id)),
    onSuccess: () => {
      toast.success('Quotation sent');
      void qc.invalidateQueries({ queryKey: ['quotation', id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const convertMutation = useMutation({
    mutationFn: () => quotationApi.convert(Number(id)),
    onSuccess: () => {
      toast.success('Quotation converted — proceed to create invoice');
      void qc.invalidateQueries({ queryKey: ['quotation', id] });
      void qc.invalidateQueries({ queryKey: ['quotations'] });
      setShowConvertConfirm(false);
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setShowConvertConfirm(false);
    },
  });

  if (isLoading) return <ERPDetailSkeleton />;
  if (!q) return <ERPEmptyState type="no-data" title="Quotation not found" />;

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title={q.quotationNumber}
        entityType="Quotation"
        entityNumber={q.quotationNumber}
        status={q.status}
        backTo="/sales/quotations"
      >
        <div className="flex items-center gap-3">
          <Badge variant={STATUS_COLORS[q.status] ?? 'default'}>{q.status}</Badge>
          {q.status === 'DRAFT' && (
            <Button variant="ghost" isLoading={sendMutation.isPending} onClick={() => sendMutation.mutate()}>
              Send
            </Button>
          )}
          {q.status === 'ACCEPTED' && (
            <Button onClick={() => setShowConvertConfirm(true)}>
              Convert to Order
            </Button>
          )}
          {['ACCEPTED', 'CONVERTED'].includes(q.status) && (
            <Button
              variant="ghost"
              onClick={() => navigate(`/sales/invoices/new?quotationId=${q.id}&customerId=${q.customerId}`)}
            >
              Create Invoice
            </Button>
          )}
        </div>
      </ERPPageHeader>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Customer', value: `ID: ${q.customerId}` },
          { label: 'Valid Until', value: formatDate(q.validUntil) },
          { label: 'Grand Total', value: formatCurrency(parseFloat(q.grandTotal)) },
          { label: 'Place of Supply', value: q.placeOfSupply },
        ].map(({ label, value }) => (
          <div key={label} className="bg-surface-card border border-default rounded-xl p-4">
            <div className="text-xs text-secondary">{label}</div>
            <div className="text-base font-semibold mt-1">{value}</div>
          </div>
        ))}
      </div>

      {/* Line items */}
      <div className="bg-surface-card border border-default rounded-xl p-4 mb-4">
        <h3 className="font-semibold mb-3 text-sm">Line Items</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-secondary border-b border-default">
              <th className="pb-2">Item</th>
              <th className="pb-2">HSN</th>
              <th className="pb-2">GST%</th>
              <th className="pb-2">Qty</th>
              <th className="pb-2">Unit Price</th>
              <th className="pb-2">Taxable</th>
              <th className="pb-2">CGST</th>
              <th className="pb-2">SGST</th>
              <th className="pb-2">IGST</th>
              <th className="pb-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-default">
            {q.lines.map((l) => (
              <tr key={l.id}>
                <td className="py-2">{l.description ?? `Item ${l.itemId}`}</td>
                <td className="py-2 text-secondary">{l.hsnCode ?? '—'}</td>
                <td className="py-2">{parseFloat(l.gstRate).toFixed(0)}%</td>
                <td className="py-2">{parseFloat(l.quantity).toFixed(3)}</td>
                <td className="py-2">{formatCurrency(parseFloat(l.unitPrice))}</td>
                <td className="py-2">{formatCurrency(parseFloat(l.taxableAmount))}</td>
                <td className="py-2">{formatCurrency(parseFloat(l.cgstAmount))}</td>
                <td className="py-2">{formatCurrency(parseFloat(l.sgstAmount))}</td>
                <td className="py-2">{formatCurrency(parseFloat(l.igstAmount))}</td>
                <td className="py-2 text-right font-semibold">{formatCurrency(parseFloat(l.lineTotal))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 pt-4 border-t border-default flex justify-end">
          <div className="w-64 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-secondary">Subtotal</span>
              <span>{formatCurrency(parseFloat(q.subtotal))}</span>
            </div>
            {parseFloat(q.discountAmount) > 0 && (
              <div className="flex justify-between text-error">
                <span>Discount</span>
                <span>−{formatCurrency(parseFloat(q.discountAmount))}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-secondary">Taxable</span>
              <span>{formatCurrency(parseFloat(q.taxableAmount))}</span>
            </div>
            {parseFloat(q.cgstAmount) > 0 && (
              <div className="flex justify-between">
                <span className="text-secondary">CGST</span>
                <span>{formatCurrency(parseFloat(q.cgstAmount))}</span>
              </div>
            )}
            {parseFloat(q.sgstAmount) > 0 && (
              <div className="flex justify-between">
                <span className="text-secondary">SGST</span>
                <span>{formatCurrency(parseFloat(q.sgstAmount))}</span>
              </div>
            )}
            {parseFloat(q.igstAmount) > 0 && (
              <div className="flex justify-between">
                <span className="text-secondary">IGST</span>
                <span>{formatCurrency(parseFloat(q.igstAmount))}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-base pt-1 border-t border-default">
              <span>Grand Total</span>
              <span>{formatCurrency(parseFloat(q.grandTotal))}</span>
            </div>
          </div>
        </div>
      </div>

      {q.notes && (
        <div className="bg-surface-card border border-default rounded-xl p-4 mb-4">
          <h3 className="font-semibold mb-1 text-sm">Notes</h3>
          <p className="text-sm text-secondary">{q.notes}</p>
        </div>
      )}

      {q.termsAndConditions && (
        <div className="bg-surface-card border border-default rounded-xl p-4 mb-4">
          <h3 className="font-semibold mb-1 text-sm">Terms & Conditions</h3>
          <p className="text-sm text-secondary whitespace-pre-wrap">{q.termsAndConditions}</p>
        </div>
      )}

      <ERPConfirmModal
        open={showConvertConfirm}
        onClose={() => setShowConvertConfirm(false)}
        onConfirm={() => convertMutation.mutate()}
        title="Convert Quotation to Order"
        description="This will mark the quotation as CONVERTED. You can then create an invoice linked to this quotation. This action cannot be undone."
        confirmLabel="Convert to Order"
        variant="warning"
        isLoading={convertMutation.isPending}
      />
    </div>
  );
}
