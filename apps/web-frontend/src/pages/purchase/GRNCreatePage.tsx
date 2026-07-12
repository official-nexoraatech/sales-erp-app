import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { purchaseOrderApi, grnApi, warehouseApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import Button from '../../components/ui/Button.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import { formatCurrency } from '../../lib/format.js';

interface POLine {
  id: number;
  itemId: number;
  description: string;
  orderedQty: number;
  receivedQty: number;
  unitPrice: string;
  gstRate: string;
  hsnCode: string | null;
}

interface PODetail {
  id: number;
  poNumber: string | null;
  supplierId: number;
  warehouseId: number;
  lines: POLine[];
}

interface GRNLineInput {
  purchaseOrderLineId: number;
  itemId: number;
  description: string;
  receivedQty: number;
  grnRate: number;
  gstRate: number;
  hsnCode?: string | undefined;
}

export default function GRNCreatePage() {
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [searchParams] = useSearchParams();
  const urlPoId = searchParams.get('poId');

  const [poIdInput, setPoIdInput] = useState(urlPoId ?? '');
  const [loadedPoId, setLoadedPoId] = useState(urlPoId ? Number(urlPoId) : null);
  const [warehouseId, setWarehouseId] = useState('');
  const [grnDate, setGrnDate] = useState<string>(new Date().toISOString().substring(0, 10));
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState('');
  const [supplierInvoiceDate, setSupplierInvoiceDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lineInputs, setLineInputs] = useState<
    Record<number, { receivedQty: string; grnRate: string }>
  >({});

  const { data: poData, isLoading: poLoading } = useQuery({
    queryKey: ['po-detail', loadedPoId],
    queryFn: () => purchaseOrderApi.getById(loadedPoId!),
    enabled: loadedPoId !== null,
  });

  const { data: warehouseData } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => warehouseApi.list(),
    enabled: hasPermission(PERMISSIONS.WAREHOUSE_VIEW),
  });

  const po = poData as PODetail;
  const warehouses =
    (warehouseData as { content?: Array<{ id: number; name: string }> })?.content ?? [];

  useEffect(() => {
    if (!po) return;
    setWarehouseId(String(po.warehouseId));
    const inputs: Record<number, { receivedQty: string; grnRate: string }> = {};
    po.lines.forEach((l) => {
      const remaining = l.orderedQty - l.receivedQty;
      inputs[l.id] = { receivedQty: String(remaining > 0 ? remaining : 0), grnRate: l.unitPrice };
    });
    setLineInputs(inputs);
  }, [po]);

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => grnApi.create(data),
    onSuccess: () => {
      toast.success('GRN created — pending approval if price variance detected');
      navigate('/purchase/grns');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleLoad = () => {
    const id = parseInt(poIdInput);
    if (!id || id <= 0) {
      toast.error('Enter a valid PO ID');
      return;
    }
    setLoadedPoId(id);
  };

  const handleSubmit = () => {
    if (!po) {
      toast.error('No PO loaded');
      return;
    }
    if (!warehouseId) {
      toast.error('Select a warehouse');
      return;
    }

    const lines: GRNLineInput[] = po.lines
      .filter((l) => {
        const qty = parseFloat(lineInputs[l.id]?.receivedQty ?? '0');
        return qty > 0;
      })
      .map((l) => ({
        purchaseOrderLineId: l.id,
        itemId: l.itemId,
        description: l.description,
        receivedQty: parseFloat(lineInputs[l.id]!.receivedQty),
        grnRate: parseFloat(lineInputs[l.id]!.grnRate),
        gstRate: parseFloat(l.gstRate),
        hsnCode: l.hsnCode ?? undefined,
        warehouseId: Number(warehouseId),
      }));

    if (lines.length === 0) {
      toast.error('Enter received quantity for at least one line');
      return;
    }

    createMutation.mutate({
      purchaseOrderId: po.id,
      supplierId: po.supplierId,
      warehouseId: Number(warehouseId),
      receivedDate: new Date(grnDate).toISOString(),
      supplierInvoiceNumber: supplierInvoiceNumber || undefined,
      supplierInvoiceDate: supplierInvoiceDate
        ? new Date(supplierInvoiceDate).toISOString()
        : undefined,
      notes: notes || undefined,
      lines,
    });
  };

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Create Goods Receipt Note"
        subtitle="Record goods received against a purchase order"
      />

      {/* PO selector */}
      <div className="bg-surface-card rounded-xl border border-default p-4 mb-4">
        <h3 className="text-sm font-semibold text-primary mb-3">Purchase Order</h3>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 max-w-xs">
            <Input
              label="PO ID *"
              type="number"
              value={poIdInput}
              onChange={(e) => setPoIdInput(e.target.value)}
              placeholder="Enter PO ID"
            />
          </div>
          {!urlPoId && (
            <Button variant="outline" onClick={handleLoad} isLoading={poLoading}>
              Load PO
            </Button>
          )}
        </div>

        {po && (
          <div className="mt-3 p-3 bg-surface-raised rounded-lg text-sm">
            <span className="text-secondary">PO #</span>{' '}
            <span className="font-mono font-medium text-primary">
              {po.poNumber ?? `Draft-${po.id}`}
            </span>
            <span className="mx-3 text-disabled">·</span>
            <span className="text-secondary">Supplier ID:</span>{' '}
            <span className="text-primary">{po.supplierId}</span>
            <span className="mx-3 text-disabled">·</span>
            <span className="text-secondary">Lines:</span>{' '}
            <span className="text-primary">{po.lines.length}</span>
          </div>
        )}
      </div>

      {po && (
        <>
          {/* Header fields */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
            <Select
              label="Warehouse *"
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              options={[
                { value: '', label: 'Select warehouse…' },
                ...warehouses.map((w) => ({ value: String(w.id), label: w.name })),
              ]}
            />
            <Input
              label="Received Date *"
              type="date"
              value={grnDate}
              onChange={(e) => setGrnDate(e.target.value)}
            />
            <Input
              label="Supplier Invoice #"
              value={supplierInvoiceNumber}
              onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
              placeholder="e.g. INV-SUP-001"
            />
            <Input
              label="Supplier Invoice Date"
              type="date"
              value={supplierInvoiceDate}
              onChange={(e) => setSupplierInvoiceDate(e.target.value)}
            />
            <div className="lg:col-span-2">
              <Input
                label="Notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any notes for this receipt"
              />
            </div>
          </div>

          {/* PO Lines */}
          <div className="bg-surface-card rounded-xl border border-default p-4 mb-4 overflow-x-auto">
            <h3 className="text-sm font-semibold text-primary mb-3">Receive Lines</h3>
            <p className="text-xs text-secondary mb-3">
              If GRN rate differs from PO rate by more than 5%, the GRN will be sent for approval.
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-secondary border-b border-default">
                  <th className="pb-2 pr-4">Item / Description</th>
                  <th className="pb-2 pr-4">Ordered</th>
                  <th className="pb-2 pr-4">Already Received</th>
                  <th className="pb-2 pr-4">Remaining</th>
                  <th className="pb-2 pr-4">Receive Qty</th>
                  <th className="pb-2 pr-4">PO Rate</th>
                  <th className="pb-2 pr-4">GRN Rate</th>
                  <th className="pb-2">GST %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-default">
                {po.lines.map((l) => {
                  const remaining = l.orderedQty - l.receivedQty;
                  const inp = lineInputs[l.id] ?? { receivedQty: '0', grnRate: l.unitPrice };
                  const grnRate = parseFloat(inp.grnRate);
                  const poRate = parseFloat(l.unitPrice);
                  const hasVariance = poRate > 0 && Math.abs(grnRate - poRate) / poRate > 0.05;

                  return (
                    <tr key={l.id} className={remaining <= 0 ? 'opacity-50' : ''}>
                      <td className="py-2 pr-4 text-primary">{l.description}</td>
                      <td className="py-2 pr-4 text-secondary">{l.orderedQty}</td>
                      <td className="py-2 pr-4 text-secondary">{l.receivedQty}</td>
                      <td className="py-2 pr-4 font-medium text-primary">{remaining}</td>
                      <td className="py-2 pr-4">
                        <input
                          type="number"
                          min="0"
                          max={remaining}
                          step="0.001"
                          value={inp.receivedQty}
                          disabled={remaining <= 0}
                          onChange={(e) =>
                            setLineInputs((prev) => ({
                              ...prev,
                              [l.id]: {
                                receivedQty: e.target.value,
                                grnRate: prev[l.id]?.grnRate ?? l.unitPrice,
                              },
                            }))
                          }
                          className="w-24 rounded border border-default bg-surface-card px-2 py-1 text-sm text-primary disabled:opacity-50"
                        />
                      </td>
                      <td className="py-2 pr-4 text-secondary">
                        {formatCurrency(parseFloat(l.unitPrice))}
                      </td>
                      <td className="py-2 pr-4">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={inp.grnRate}
                          disabled={remaining <= 0}
                          onChange={(e) =>
                            setLineInputs((prev) => ({
                              ...prev,
                              [l.id]: {
                                receivedQty: prev[l.id]?.receivedQty ?? '0',
                                grnRate: e.target.value,
                              },
                            }))
                          }
                          className={`w-28 rounded border px-2 py-1 text-sm text-primary disabled:opacity-50 bg-surface-card ${
                            hasVariance ? 'border-warning' : 'border-default'
                          }`}
                        />
                        {hasVariance && (
                          <p className="text-xs text-warning mt-0.5">&gt;5% variance</p>
                        )}
                      </td>
                      <td className="py-2 text-secondary">{l.gstRate}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!po && loadedPoId !== null && !poLoading && (
        <div className="bg-surface-card rounded-xl border border-default p-8 text-center text-secondary text-sm">
          Purchase order not found or not in an approved state.
        </div>
      )}

      {!loadedPoId && !urlPoId && (
        <div className="bg-surface-card rounded-xl border border-default p-8 text-center text-disabled text-sm">
          Enter a Purchase Order ID above and click "Load PO" to begin receiving goods.
        </div>
      )}

      <div className="flex justify-end gap-3 mt-4">
        <Button variant="ghost" onClick={() => navigate('/purchase/grns')}>
          Cancel
        </Button>
        {po && (
          <Button isLoading={createMutation.isPending} onClick={handleSubmit}>
            Create GRN
          </Button>
        )}
      </div>
    </div>
  );
}
