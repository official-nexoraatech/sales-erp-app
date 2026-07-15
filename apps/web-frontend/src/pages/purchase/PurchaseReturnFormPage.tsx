import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { purchaseReturnApi, grnApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPFormSection from '../../components/erp/ERPFormSection.js';
import ERPStickyFooter from '../../components/erp/ERPStickyFooter.js';
import Button from '../../components/ui/Button.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import { formatCurrency } from '../../lib/format.js';

interface GRNLine {
  id: number;
  itemId: number;
  variantId?: number | null;
  receivedQty: string;
  grnRate: string;
  gstRate: string;
}

interface GRNForReturn {
  id: number;
  supplierId: number;
  branchId: number;
  warehouseId: number;
  lines: GRNLine[];
}

const RETURN_REASONS = [
  'QUALITY_ISSUE',
  'WRONG_ITEM',
  'EXCESS_QUANTITY',
  'DAMAGED',
  'OTHER',
] as const;
const LIST_PATH = '/purchase/returns';

export default function PurchaseReturnFormPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [grnId, setGrnId] = useState('');
  const [loadedGrnId, setLoadedGrnId] = useState<number | null>(null);
  const [returnQtys, setReturnQtys] = useState<Record<number, string>>({});
  const [reason, setReason] = useState<string>('QUALITY_ISSUE');
  const [returnDate, setReturnDate] = useState<string>(new Date().toISOString().substring(0, 10));
  const [returnNotes, setReturnNotes] = useState('');

  const { data: grnData, isFetching: loadingGrn } = useQuery({
    queryKey: ['grn-for-return', loadedGrnId],
    queryFn: () => grnApi.getById(loadedGrnId!),
    enabled: loadedGrnId !== null,
  });
  const grn = grnData as GRNForReturn | undefined;
  const selectedLines = grn
    ? grn.lines
        .map((l) => ({ line: l, qty: parseFloat(returnQtys[l.id] ?? '0') }))
        .filter(({ qty }) => qty > 0)
    : [];

  const createMutation = useMutation({
    mutationFn: (d: Record<string, unknown>) => purchaseReturnApi.create(d),
    onSuccess: () => {
      toast.success('Purchase return created as DRAFT');
      qc.invalidateQueries({ queryKey: ['purchase-returns'] });
      navigate(LIST_PATH);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title="New Purchase Return"
        subtitle="Return goods received from a supplier against a GRN"
        backTo={LIST_PATH}
      />

      <ERPFormSection title="Source GRN" columns={1}>
        <div className="flex items-end gap-2">
          <Input
            label="GRN ID *"
            type="number"
            placeholder="ID of the GRN to return against"
            value={grnId}
            onChange={(e) => {
              setGrnId(e.target.value);
              setReturnQtys({});
            }}
            wrapperClassName="flex-1"
          />
          <Button
            variant="outline"
            disabled={!grnId}
            isLoading={loadingGrn}
            onClick={() => setLoadedGrnId(Number(grnId))}
          >
            Load GRN
          </Button>
        </div>

        {grn && (
          <div className="border border-default rounded-lg p-3 space-y-2">
            <p className="text-xs text-secondary">Select quantity to return per line:</p>
            {grn.lines.map((l) => (
              <div key={l.id} className="grid grid-cols-3 gap-2 items-center text-sm">
                <span>
                  Item #{l.itemId} ({l.receivedQty} @ {formatCurrency(parseFloat(l.grnRate))})
                </span>
                <Input
                  type="number"
                  min="0"
                  max={l.receivedQty}
                  step="0.001"
                  placeholder="0"
                  value={returnQtys[l.id] ?? ''}
                  onChange={(e) => setReturnQtys((prev) => ({ ...prev, [l.id]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        )}
      </ERPFormSection>

      <ERPFormSection title="Return Details" columns={2}>
        <Input
          label="Return Date *"
          type="date"
          value={returnDate}
          onChange={(e) => setReturnDate(e.target.value)}
        />
        <Select
          label="Reason *"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          options={RETURN_REASONS.map((r) => ({ value: r, label: r.replace(/_/g, ' ') }))}
        />
        <Input
          label="Notes"
          wrapperClassName="sm:col-span-2"
          value={returnNotes}
          onChange={(e) => setReturnNotes(e.target.value)}
          placeholder="Optional notes for this return"
        />
      </ERPFormSection>
      <p className="text-xs text-secondary mt-3">
        After creating, the return is in DRAFT status. Approve it to deduct stock and auto-generate
        a debit note.
      </p>

      <ERPStickyFooter>
        <Button variant="secondary" onClick={() => navigate(LIST_PATH)}>
          Cancel
        </Button>
        <Button
          isLoading={createMutation.isPending}
          disabled={!grn || selectedLines.length === 0}
          onClick={() =>
            grn &&
            createMutation.mutate({
              grnId: grn.id,
              supplierId: grn.supplierId,
              branchId: grn.branchId,
              warehouseId: grn.warehouseId,
              returnDate: new Date(returnDate).toISOString(),
              reason,
              returnNotes: returnNotes || undefined,
              lines: selectedLines.map(({ line, qty }) => ({
                grnLineId: line.id,
                itemId: line.itemId,
                variantId: line.variantId ?? undefined,
                returnQty: qty,
                unitPrice: parseFloat(line.grnRate),
                gstRate: parseFloat(line.gstRate),
              })),
            })
          }
        >
          Create Return
        </Button>
      </ERPStickyFooter>
    </div>
  );
}
