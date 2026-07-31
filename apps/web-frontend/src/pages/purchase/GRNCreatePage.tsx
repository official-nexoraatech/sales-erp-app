import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { purchaseOrderApi, grnApi, warehouseApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPStickyFooter from '../../components/erp/ERPStickyFooter.js';
import Button from '../../components/ui/Button.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import { formatCurrency } from '../../lib/format.js';
import { toFieldErrors } from '../../lib/zodFieldErrors.js';
import { grnFormSchema } from '../../schemas/purchase-transactions.schema.js';

interface POLine {
  id: number;
  itemId: number;
  itemName?: string;
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
  supplierName?: string;
  branchId: number;
  warehouseId: number;
  lines: POLine[];
}

interface GRNLineInput {
  purchaseOrderLineId: number;
  itemId: number;
  description?: string;
  receivedQty: number;
  grnRate: number;
  gstRate: number;
  hsnCode?: string | undefined;
  batchNumber?: string | undefined;
  expiryDate?: string | undefined;
  rejectedQty?: number | undefined;
  damagedQty?: number | undefined;
  qcStatus?: 'PENDING' | 'PASSED' | 'FAILED' | 'NA' | undefined;
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
    Record<
      number,
      {
        receivedQty: string;
        grnRate: string;
        batchNumber: string;
        expiryDate: string;
        rejectedQty: string;
        damagedQty: string;
        qcStatus: 'PENDING' | 'PASSED' | 'FAILED' | 'NA';
      }
    >
  >({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

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
    const inputs: typeof lineInputs = {};
    po.lines.forEach((l) => {
      const remaining = l.orderedQty - l.receivedQty;
      inputs[l.id] = {
        receivedQty: String(remaining > 0 ? remaining : 0),
        grnRate: l.unitPrice,
        batchNumber: '',
        expiryDate: '',
        rejectedQty: '0',
        damagedQty: '0',
        qcStatus: 'NA',
      };
    });
    setLineInputs(inputs);
  }, [po]);

  const updateLine = (id: number, patch: Partial<(typeof lineInputs)[number]>) => {
    setLineInputs((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] ?? {
          receivedQty: '0',
          grnRate: '0',
          batchNumber: '',
          expiryDate: '',
          rejectedQty: '0',
          damagedQty: '0',
          qcStatus: 'NA',
        }),
        ...patch,
      },
    }));
  };

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

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!po) return;

    const filteredLines = po.lines.filter((l) => {
      const qty = parseFloat(lineInputs[l.id]?.receivedQty ?? '0');
      return qty > 0;
    });

    const result = grnFormSchema.safeParse({
      purchaseOrderId: po.id,
      warehouseId: warehouseId ? Number(warehouseId) : undefined,
      grnDate,
      lines: filteredLines.map((l) => ({
        purchaseOrderLineId: l.id,
        itemId: l.itemId,
        receivedQty: parseFloat(lineInputs[l.id]?.receivedQty ?? '0'),
      })),
    });
    if (!result.success) {
      setFieldErrors(toFieldErrors(result.error));
      toast.error('Fix the highlighted fields before saving');
      return;
    }
    setFieldErrors({});

    const lines: GRNLineInput[] = filteredLines.map((l) => {
      const inp = lineInputs[l.id]!;
      return {
        purchaseOrderLineId: l.id,
        itemId: l.itemId,
        description: l.description ?? undefined,
        receivedQty: parseFloat(inp.receivedQty),
        grnRate: parseFloat(inp.grnRate),
        gstRate: parseFloat(l.gstRate),
        hsnCode: l.hsnCode ?? undefined,
        warehouseId: Number(warehouseId),
        batchNumber: inp.batchNumber || undefined,
        expiryDate: inp.expiryDate ? new Date(inp.expiryDate).toISOString() : undefined,
        rejectedQty: parseFloat(inp.rejectedQty || '0'),
        damagedQty: parseFloat(inp.damagedQty || '0'),
        qcStatus: inp.qcStatus,
      };
    });

    createMutation.mutate({
      purchaseOrderId: po.id,
      supplierId: po.supplierId,
      branchId: po.branchId,
      warehouseId: Number(warehouseId),
      // Backend field is `grnDate`, not `receivedDate` — was silently 500ing on every GRN
      // creation ("Required" on both branchId and grnDate) until this fix.
      grnDate: new Date(grnDate).toISOString(),
      supplierInvoiceNumber: supplierInvoiceNumber || undefined,
      supplierInvoiceDate: supplierInvoiceDate
        ? new Date(supplierInvoiceDate).toISOString()
        : undefined,
      notes: notes || undefined,
      lines,
    });
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <ERPPageHeader
        variant="detail"
        title="Create Goods Receipt Note"
        subtitle="Record goods received against a purchase order"
        backTo="/purchase/grns"
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
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleLoad();
                }
              }}
              placeholder="Enter PO ID"
              error={fieldErrors.purchaseOrderId}
            />
          </div>
          {!urlPoId && (
            <Button type="button" variant="outline" onClick={handleLoad} isLoading={poLoading}>
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
            <span className="text-secondary">Supplier:</span>{' '}
            <span className="text-primary">{po.supplierName ?? po.supplierId}</span>
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
              error={fieldErrors.warehouseId}
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
              error={fieldErrors.grnDate}
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
            {fieldErrors.lines && (
              <p className="text-xs text-danger mb-3" role="alert">
                {fieldErrors.lines}
              </p>
            )}
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
                  <th className="pb-2 pr-4">GST %</th>
                  <th className="pb-2 pr-4">Batch #</th>
                  <th className="pb-2 pr-4">Expiry</th>
                  <th className="pb-2 pr-4">Rejected</th>
                  <th className="pb-2 pr-4">Damaged</th>
                  <th className="pb-2">QC Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-default">
                {po.lines.map((l) => {
                  const remaining = l.orderedQty - l.receivedQty;
                  const inp = lineInputs[l.id] ?? {
                    receivedQty: '0',
                    grnRate: l.unitPrice,
                    batchNumber: '',
                    expiryDate: '',
                    rejectedQty: '0',
                    damagedQty: '0',
                    qcStatus: 'NA' as const,
                  };
                  const grnRate = parseFloat(inp.grnRate);
                  const poRate = parseFloat(l.unitPrice);
                  const hasVariance = poRate > 0 && Math.abs(grnRate - poRate) / poRate > 0.05;

                  return (
                    <tr key={l.id} className={remaining <= 0 ? 'opacity-50' : ''}>
                      <td className="py-2 pr-4 text-primary">{l.itemName ?? l.description}</td>
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
                          onChange={(e) => updateLine(l.id, { receivedQty: e.target.value })}
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
                          onChange={(e) => updateLine(l.id, { grnRate: e.target.value })}
                          className={`w-28 rounded border px-2 py-1 text-sm text-primary disabled:opacity-50 bg-surface-card ${
                            hasVariance ? 'border-warning' : 'border-default'
                          }`}
                        />
                        {hasVariance && (
                          <p className="text-xs text-warning mt-0.5">&gt;5% variance</p>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-secondary">{l.gstRate}%</td>
                      <td className="py-2 pr-4">
                        <input
                          type="text"
                          value={inp.batchNumber}
                          disabled={remaining <= 0}
                          onChange={(e) => updateLine(l.id, { batchNumber: e.target.value })}
                          placeholder="Optional"
                          className="w-24 rounded border border-default bg-surface-card px-2 py-1 text-sm text-primary disabled:opacity-50"
                        />
                      </td>
                      <td className="py-2 pr-4">
                        <input
                          type="date"
                          value={inp.expiryDate}
                          disabled={remaining <= 0}
                          onChange={(e) => updateLine(l.id, { expiryDate: e.target.value })}
                          className="w-32 rounded border border-default bg-surface-card px-2 py-1 text-sm text-primary disabled:opacity-50"
                        />
                      </td>
                      <td className="py-2 pr-4">
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          value={inp.rejectedQty}
                          disabled={remaining <= 0}
                          onChange={(e) => updateLine(l.id, { rejectedQty: e.target.value })}
                          className="w-20 rounded border border-default bg-surface-card px-2 py-1 text-sm text-primary disabled:opacity-50"
                        />
                      </td>
                      <td className="py-2 pr-4">
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          value={inp.damagedQty}
                          disabled={remaining <= 0}
                          onChange={(e) => updateLine(l.id, { damagedQty: e.target.value })}
                          className="w-20 rounded border border-default bg-surface-card px-2 py-1 text-sm text-primary disabled:opacity-50"
                        />
                      </td>
                      <td className="py-2">
                        <select
                          value={inp.qcStatus}
                          disabled={remaining <= 0}
                          onChange={(e) =>
                            updateLine(l.id, {
                              qcStatus: e.target.value as 'PENDING' | 'PASSED' | 'FAILED' | 'NA',
                            })
                          }
                          className="w-24 rounded border border-default bg-surface-card px-2 py-1 text-sm text-primary disabled:opacity-50"
                        >
                          <option value="NA">N/A</option>
                          <option value="PENDING">Pending</option>
                          <option value="PASSED">Passed</option>
                          <option value="FAILED">Failed</option>
                        </select>
                      </td>
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

      <ERPStickyFooter>
        <Button type="button" variant="secondary" onClick={() => navigate('/purchase/grns')}>
          Cancel
        </Button>
        {po && (
          <Button type="submit" isLoading={createMutation.isPending}>
            Create GRN
          </Button>
        )}
      </ERPStickyFooter>
    </form>
  );
}
