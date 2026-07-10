import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { productionApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPFormSkeleton } from '../../components/erp/ERPSkeleton.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Select from '../../components/ui/Select.js';
import Input from '../../components/ui/Input.js';

interface QCEntry {
  pieceNumber: number;
  result: 'PASS' | 'FAIL' | 'REWORK';
  defectNotes: string;
}

interface OrderDetail {
  id: number;
  orderNumber: string;
  status: string;
  orderedQty: number;
  outputItemName?: string;
}

export default function JobWorkQualityCheckPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['job-work-order', id],
    queryFn: () => productionApi.getJobWorkOrder(Number(id)),
    enabled: !!id,
  });
  const order = (data as OrderDetail | undefined);

  const [entries, setEntries] = useState<QCEntry[]>([{ pieceNumber: 1, result: 'PASS', defectNotes: '' }]);
  const [receivedQty, setReceivedQty] = useState('');
  const [rejectedQty, setRejectedQty] = useState('0');
  const [scrapQty, setScrapQty] = useState('0');

  function addEntry() {
    setEntries((prev) => [
      ...prev,
      { pieceNumber: prev.length + 1, result: 'PASS', defectNotes: '' },
    ]);
  }

  function updateEntry(idx: number, field: keyof QCEntry, value: string) {
    setEntries((prev) =>
      prev.map((e, i) => (i === idx ? { ...e, [field]: field === 'pieceNumber' ? parseInt(value, 10) : value } : e))
    );
  }

  const submitQCMutation = useMutation({
    mutationFn: () =>
      productionApi.submitQualityChecks(Number(id), {
        entries: entries.map((e) => ({ ...e, defectNotes: e.defectNotes || undefined })),
      }),
    onSuccess: () => {
      toast.success('Quality checks saved');
      qc.invalidateQueries({ queryKey: ['job-work-order', id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const completeMutation = useMutation({
    mutationFn: () =>
      productionApi.completeJobWorkOrder(Number(id), {
        receivedQty: parseFloat(receivedQty),
        rejectedQty: parseFloat(rejectedQty),
        scrapQty: parseFloat(scrapQty),
      }),
    onSuccess: () => {
      toast.success('Job work order completed');
      navigate('/production/job-work');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <ERPFormSkeleton />;
  if (!order) return <p className="text-secondary text-sm">Order not found.</p>;

  return (
    <div className="max-w-3xl">
      <ERPPageHeader
        variant="detail"
        title={`Quality Check — ${order.orderNumber}`}
        subtitle={order.outputItemName ?? ''}
        backTo="/production/job-work"
      />

      <div className="bg-surface-card rounded-xl border border-default p-4 mb-6 flex items-center gap-4">
        <div>
          <p className="text-xs text-secondary">Status</p>
          <Badge variant="warning">{order.status.replace(/_/g, ' ')}</Badge>
        </div>
        <div>
          <p className="text-xs text-secondary">Ordered Qty</p>
          <p className="font-semibold">{order.orderedQty}</p>
        </div>
      </div>

      <div className="bg-surface-card rounded-xl border border-default p-6 space-y-4 mb-6">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-primary">Piece-by-Piece Inspection</h3>
          <Button type="button" variant="outline" size="sm" onClick={addEntry}>+ Add Piece</Button>
        </div>
        <div className="space-y-2">
          {entries.map((entry, idx) => (
            <div key={idx} className="grid grid-cols-4 gap-3 items-end">
              <div>
                <label className="block text-xs text-secondary mb-1">Piece #</label>
                <Input
                  type="number"
                  min="1"
                  value={entry.pieceNumber}
                  onChange={(e) => updateEntry(idx, 'pieceNumber', e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-secondary mb-1">Result</label>
                <Select
                  value={entry.result}
                  onChange={(e) => updateEntry(idx, 'result', e.target.value)}
                >
                  <option value="PASS">PASS</option>
                  <option value="FAIL">FAIL</option>
                  <option value="REWORK">REWORK</option>
                </Select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-secondary mb-1">Defect Notes</label>
                <Input
                  value={entry.defectNotes}
                  onChange={(e) => updateEntry(idx, 'defectNotes', e.target.value)}
                  placeholder={entry.result !== 'PASS' ? 'Describe defect…' : ''}
                />
              </div>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => submitQCMutation.mutate()}
          disabled={submitQCMutation.isPending}
        >
          {submitQCMutation.isPending ? 'Saving…' : 'Save QC Entries'}
        </Button>
      </div>

      <div className="bg-surface-card rounded-xl border border-default p-6 space-y-4">
        <h3 className="font-semibold text-primary">Complete Order</h3>
        <div className="grid grid-cols-3 gap-4">
          <Input label="Received Qty" required type="number" min="0" step="0.01" value={receivedQty} onChange={(e) => setReceivedQty(e.target.value)} />
          <Input label="Rejected Qty" type="number" min="0" step="0.01" value={rejectedQty} onChange={(e) => setRejectedQty(e.target.value)} />
          <Input label="Scrap Qty" type="number" min="0" step="0.01" value={scrapQty} onChange={(e) => setScrapQty(e.target.value)} />
        </div>
        <div className="flex gap-3">
          <Button
            type="button"
            disabled={!receivedQty || completeMutation.isPending}
            onClick={() => completeMutation.mutate()}
          >
            {completeMutation.isPending ? 'Completing…' : 'Mark as Completed'}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate('/production/job-work')}>Back</Button>
        </div>
      </div>
    </div>
  );
}
