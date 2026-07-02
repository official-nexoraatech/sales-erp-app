import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { physicalVerifApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import { formatDate, formatDatetime, formatCurrency } from '../../lib/format.js';

interface Verification {
  id: number;
  verificationNumber: string;
  warehouseId: number;
  status: string;
  snapshotTakenAt?: string;
}

interface VerifLine {
  id: number;
  itemId: number;
  systemQty: string;
  physicalQty?: string;
  variance?: string;
}

export default function PhysicalVerificationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [counts, setCounts] = useState<Record<number, number>>({});

  const { data, isLoading } = useQuery({
    queryKey: ['physical-verif', id],
    queryFn: () => physicalVerifApi.getById(Number(id)),
    enabled: !!id,
  });

  const { data: varianceData } = useQuery({
    queryKey: ['physical-verif-variances', id],
    queryFn: () => physicalVerifApi.variances(Number(id)),
    enabled: !!(id && (data as { data?: Verification })?.data?.status === 'COUNTING'),
  });

  const verif = (data as { data?: Verification })?.data;
  const variances: VerifLine[] = (varianceData as { data?: VerifLine[] })?.data ?? [];

  const startMutation = useMutation({
    mutationFn: () => physicalVerifApi.startCounting(Number(id)),
    onSuccess: () => { toast.success('Counting started — snapshot taken'); qc.invalidateQueries({ queryKey: ['physical-verif', id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveMutation = useMutation({
    mutationFn: (countsArr: Array<{ lineId: number; physicalQty: number }>) =>
      physicalVerifApi.updateCounts(Number(id), countsArr),
    onSuccess: () => { toast.success('Counts saved'); qc.invalidateQueries({ queryKey: ['physical-verif-variances', id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const approveMutation = useMutation({
    mutationFn: () => physicalVerifApi.approve(Number(id)),
    onSuccess: () => {
      toast.success('Verification approved — adjustments created');
      qc.invalidateQueries({ queryKey: ['physical-verif', id] });
      navigate('/inventory/physical-verifications');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !verif) return <div className="p-8 text-center text-gray-500">Loading…</div>;

  return (
    <div>
      <ERPPageHeader variant="list"
        title={`Physical Verification ${verif.verificationNumber}`}
        subtitle={`Warehouse ${verif.warehouseId} · ${verif.status}`}
      >
        <Badge variant={verif.status === 'APPROVED' ? 'success' : verif.status === 'COUNTING' ? 'warning' : 'default'}>
          {verif.status}
        </Badge>
      </ERPPageHeader>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 space-y-6">
        {verif.status === 'DRAFT' && (
          <Button onClick={() => startMutation.mutate()} isLoading={startMutation.isPending}>
            Start Counting (Take Snapshot)
          </Button>
        )}

        {verif.status === 'COUNTING' && (
          <>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Snapshot taken {verif.snapshotTakenAt ? formatDatetime(verif.snapshotTakenAt) : ''}. Enter physical counts below.
            </p>

            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
                  <th className="pb-2">Item ID</th>
                  <th className="pb-2">System Qty</th>
                  <th className="pb-2">Physical Qty</th>
                  <th className="pb-2">Variance</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-gray-700">
                {variances.map((line) => {
                  const physical = counts[line.id] ?? (line.physicalQty ? parseFloat(line.physicalQty) : undefined);
                  const systemQty = parseFloat(line.systemQty);
                  const variance = physical !== undefined ? physical - systemQty : undefined;
                  return (
                    <tr key={line.id}>
                      <td className="py-2">{line.itemId}</td>
                      <td className="py-2">{systemQty.toFixed(3)}</td>
                      <td className="py-2">
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          value={physical ?? ''}
                          onChange={(e) => setCounts((prev) => ({ ...prev, [line.id]: parseFloat(e.target.value) || 0 }))}
                          className="w-28 rounded border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm px-2 py-1"
                        />
                      </td>
                      <td className={`py-2 font-medium ${variance === undefined ? '' : variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {variance !== undefined ? (variance >= 0 ? '+' : '') + variance.toFixed(3) : '–'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="flex gap-3">
              <Button
                variant="ghost"
                onClick={() => {
                  const payload = Object.entries(counts).map(([lineId, physicalQty]) => ({
                    lineId: Number(lineId),
                    physicalQty,
                  }));
                  saveMutation.mutate(payload);
                }}
                isLoading={saveMutation.isPending}
              >
                Save Counts
              </Button>
              <Button onClick={() => approveMutation.mutate()} isLoading={approveMutation.isPending}>
                Approve & Generate Adjustment
              </Button>
            </div>
          </>
        )}

        {verif.status === 'APPROVED' && (
          <p className="text-green-700 dark:text-green-400 font-medium">
            Verification approved. Stock adjustments have been created automatically.
          </p>
        )}
      </div>
    </div>
  );
}
