import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { stockTransferApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPDetailSkeleton } from '../../components/erp/ERPSkeleton.js';
import Button from '../../components/ui/Button.js';

interface TransferLine {
  id: number;
  itemId: number;
  requestedQty: string;
  dispatchedQty: string;
  receivedQty: string;
}

interface Transfer {
  id: number;
  transferNumber: string;
  status: string;
  lines: TransferLine[];
}

export default function StockTransferReceivePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [receivedQtys, setReceivedQtys] = useState<Record<number, number>>({});

  const { data, isLoading } = useQuery({
    queryKey: ['stock-transfer', id],
    queryFn: () => stockTransferApi.getById(Number(id)),
    enabled: !!id,
  });

  const transfer = data as Transfer;

  const receiveMutation = useMutation({
    mutationFn: (lines: Array<{ lineId: number; receivedQty: number }>) =>
      stockTransferApi.receive(Number(id), lines),
    onSuccess: () => {
      toast.success('Transfer received — stock updated');
      qc.invalidateQueries({ queryKey: ['stock-transfers'] });
      navigate('/inventory/transfers');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !transfer) return <ERPDetailSkeleton />;

  const lines = transfer.lines ?? [];

  function handleReceive() {
    const payload = lines.map((l) => ({
      lineId: l.id,
      receivedQty: receivedQtys[l.id] ?? parseFloat(l.dispatchedQty ?? l.requestedQty),
    }));
    receiveMutation.mutate(payload);
  }

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title={`Receive Transfer ${transfer.transferNumber}`}
        subtitle="Enter actual quantities received per line"
      />

      <div className="bg-surface-card rounded-xl border border-default p-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-secondary border-b border-default">
                <th className="pb-2 font-medium">Item ID</th>
                <th className="pb-2 font-medium">Requested</th>
                <th className="pb-2 font-medium">Dispatched</th>
                <th className="pb-2 font-medium">Received Qty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-default">
              {lines.map((line) => {
                const dispatched = parseFloat(line.dispatchedQty ?? line.requestedQty);
                const value = receivedQtys[line.id] ?? dispatched;
                return (
                  <tr key={line.id}>
                    <td className="py-2">{line.itemId}</td>
                    <td className="py-2">{parseFloat(line.requestedQty).toFixed(3)}</td>
                    <td className="py-2">{dispatched.toFixed(3)}</td>
                    <td className="py-2">
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        value={value}
                        onChange={(e) =>
                          setReceivedQtys((prev) => ({
                            ...prev,
                            [line.id]: parseFloat(e.target.value) || 0,
                          }))
                        }
                        className="w-28 rounded border-default bg-surface-card text-sm px-2 py-1"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button variant="ghost" onClick={() => navigate('/inventory/transfers')}>
            Cancel
          </Button>
          <Button onClick={handleReceive} isLoading={receiveMutation.isPending}>
            Confirm Receipt
          </Button>
        </div>
      </div>
    </div>
  );
}
