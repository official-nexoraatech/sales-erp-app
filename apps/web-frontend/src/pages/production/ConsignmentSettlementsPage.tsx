import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { productionApi, supplierApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import { formatDate, formatCurrency } from '../../lib/format.js';

interface Settlement {
  id: number;
  settlementNumber: string;
  supplierName?: string;
  periodFrom: string;
  periodTo: string;
  totalSoldQty: number;
  totalAmount: string;
  status: string;
  settledAt?: string;
}

const STATUS_VARIANT: Record<string, 'default' | 'info' | 'warning' | 'success' | 'danger'> = {
  PENDING: 'warning',
  SETTLED: 'success',
  DISPUTED: 'danger',
};

export default function ConsignmentSettlementsPage() {
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [supplierFilter, setSupplierFilter] = useState('');

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers-list'],
    queryFn: () => supplierApi.list(),
  });
  const suppliers = ((suppliersData as Record<string, unknown>)?.content as { id: number; name: string }[]) ?? [];

  const { data, isLoading } = useQuery({
    queryKey: ['consignment-settlements', supplierFilter],
    queryFn: () =>
      supplierFilter
        ? productionApi.listConsignmentSettlements({ supplierId: parseInt(supplierFilter, 10) })
        : productionApi.listConsignmentSettlements(),
  });
  const settlements: Settlement[] = ((data as Record<string, unknown>)?.data as Settlement[]) ?? [];

  // Create settlement form
  const [cSupplierId, setCSupplierId] = useState('');
  const [cPeriodFrom, setCPeriodFrom] = useState('');
  const [cPeriodTo, setCPeriodTo] = useState(new Date().toISOString().slice(0, 10));

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => productionApi.createConsignmentSettlement(payload),
    onSuccess: () => {
      toast.success('Settlement created');
      setShowCreateForm(false);
      qc.invalidateQueries({ queryKey: ['consignment-settlements'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const settleMutation = useMutation({
    mutationFn: ({ id, paymentReference }: { id: number; paymentReference: string }) =>
      productionApi.settleConsignment(id, { paymentReference }),
    onSuccess: () => {
      toast.success('Settlement marked as paid');
      qc.invalidateQueries({ queryKey: ['consignment-settlements'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    createMutation.mutate({
      supplierId: parseInt(cSupplierId, 10),
      periodFrom: new Date(cPeriodFrom).toISOString(),
      periodTo: new Date(cPeriodTo).toISOString(),
    });
  }

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Consignment Settlements"
        subtitle="Monthly settlement of consigned goods sold to customers."
        actions={
          hasPermission(PERMISSIONS.CONSIGNMENT_SETTLE) ? (
            <Button onClick={() => setShowCreateForm(!showCreateForm)}>
              {showCreateForm ? 'Cancel' : '+ Create Settlement'}
            </Button>
          ) : undefined
        }
      />

      {showCreateForm && (
        <div className="bg-surface-card rounded-xl border border-default p-6 mb-6">
          <h3 className="font-semibold text-primary mb-4">Create Settlement</h3>
          <form onSubmit={handleCreate} className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-secondary mb-1">Supplier *</label>
              <Select value={cSupplierId} onChange={(e) => setCSupplierId(e.target.value)} required>
                <option value="">Select supplier</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary mb-1">Period From *</label>
              <Input type="date" value={cPeriodFrom} onChange={(e) => setCPeriodFrom(e.target.value)} required />
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary mb-1">Period To *</label>
              <Input type="date" value={cPeriodTo} onChange={(e) => setCPeriodTo(e.target.value)} required />
            </div>
            <div className="col-span-3 flex gap-3">
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating…' : 'Create Settlement'}
              </Button>
            </div>
          </form>
        </div>
      )}

      <div className="mb-4">
        <Select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)} className="max-w-xs">
          <option value="">All Suppliers</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </div>

      {isLoading ? (
        <p className="text-secondary text-sm">Loading…</p>
      ) : settlements.length === 0 ? (
        <p className="text-disabled text-sm">No settlements found.</p>
      ) : (
        <table className="w-full text-sm bg-surface-card rounded-xl border border-default overflow-hidden">
          <thead className="bg-surface-subtle">
            <tr className="text-left text-xs uppercase text-secondary">
              <th className="px-4 py-3">Settlement #</th>
              <th className="px-4 py-3">Supplier</th>
              <th className="px-4 py-3">Period</th>
              <th className="px-4 py-3 text-right">Sold Qty</th>
              <th className="px-4 py-3 text-right">Amount</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Settled On</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-default">
            {settlements.map((s) => (
              <tr key={s.id} className="hover:bg-surface-subtle">
                <td className="px-4 py-3 font-mono text-xs">{s.settlementNumber}</td>
                <td className="px-4 py-3">{s.supplierName ?? '—'}</td>
                <td className="px-4 py-3 text-xs">
                  {formatDate(s.periodFrom)} – {formatDate(s.periodTo)}
                </td>
                <td className="px-4 py-3 text-right font-mono">{s.totalSoldQty}</td>
                <td className="px-4 py-3 text-right font-mono">{formatCurrency(Number(s.totalAmount))}</td>
                <td className="px-4 py-3">
                  <Badge variant={STATUS_VARIANT[s.status] ?? 'default'}>{s.status}</Badge>
                </td>
                <td className="px-4 py-3 text-xs">{s.settledAt ? formatDate(s.settledAt) : '—'}</td>
                <td className="px-4 py-3 text-right">
                  {hasPermission(PERMISSIONS.CONSIGNMENT_SETTLE) && s.status === 'PENDING' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const ref = prompt('Payment reference:');
                        if (ref) settleMutation.mutate({ id: s.id, paymentReference: ref });
                      }}
                    >
                      Mark Settled
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
