import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { opportunityApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { useConfirm } from '../../context/ConfirmContext.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPFormSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Badge from '../../components/ui/Badge.js';
import Button from '../../components/ui/Button.js';
import Input from '../../components/ui/Input.js';

interface LineItem {
  id: number;
  itemId: number;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
}

interface StockEntry {
  itemId: number;
  itemName: string;
  totalAvailableQty: number;
  warehouseCount: number;
}

interface HistoryEntry {
  id: number;
  activityType: string;
  fromStage?: string | null;
  toStage?: string | null;
  notes?: string | null;
  createdAt: string;
}

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(n);
}

// CRM-ROADMAP Phase 2, Feature 1. Stage transitions (drag-and-drop, Won/Lost modals) live on
// the Pipeline Kanban board, not here — this page is the deal's working surface for line items
// and history, not a second place to implement the same transition modals.
export default function OpportunityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canUpdate = hasPermission(PERMISSIONS.OPPORTUNITY_UPDATE);
  const canDelete = hasPermission(PERMISSIONS.OPPORTUNITY_DELETE);
  const [newLine, setNewLine] = useState({ itemId: '', quantity: '', unitPrice: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['opportunity', id],
    queryFn: () => opportunityApi.get(Number(id)),
  });
  const opportunity = data as
    | (Record<string, unknown> & {
        lines: LineItem[];
        stock: StockEntry[];
        history: HistoryEntry[];
      })
    | undefined;

  const addLineMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => opportunityApi.addLineItem(Number(id), body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['opportunity', id] });
      setNewLine({ itemId: '', quantity: '', unitPrice: '' });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const removeLineMutation = useMutation({
    mutationFn: (lineItemId: number) => opportunityApi.removeLineItem(Number(id), lineItemId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['opportunity', id] }),
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => opportunityApi.delete(Number(id)),
    onSuccess: () => {
      toast.success('Opportunity deleted');
      navigate('/crm/pipeline');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  async function handleDelete() {
    if (
      await confirm({
        title: 'Delete this opportunity?',
        message: 'This cannot be undone.',
        variant: 'danger',
      })
    ) {
      deleteMutation.mutate();
    }
  }

  function handleAddLine() {
    const itemId = Number(newLine.itemId);
    const quantity = Number(newLine.quantity);
    const unitPrice = Number(newLine.unitPrice);
    if (!itemId || !quantity || unitPrice < 0) {
      toast.error('Item ID, quantity, and unit price are required');
      return;
    }
    addLineMutation.mutate({ itemId, quantity, unitPrice });
  }

  if (isLoading) {
    return (
      <div>
        <ERPPageHeader variant="detail" title="Opportunity" backTo="/crm/pipeline" />
        <ERPFormSkeleton />
      </div>
    );
  }

  if (!opportunity) return <ERPEmptyState type="error" />;

  const stockByItem = new Map(opportunity.stock.map((s) => [s.itemId, s]));

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title={opportunity['name'] as string}
        subtitle={`${opportunity['dealType'] ?? 'General'} deal`}
        backTo="/crm/pipeline"
        actions={
          <>
            {canDelete && (
              <Button variant="danger-outline" size="sm" onClick={handleDelete}>
                <Trash2 size={14} className="mr-1.5" /> Delete
              </Button>
            )}
            {canUpdate && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate(`/crm/pipeline/${id}/edit`)}
              >
                <Pencil size={14} className="mr-1.5" /> Edit
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <div className="bg-surface-card rounded-xl border border-default p-4">
          <p className="text-xs text-secondary uppercase tracking-wide mb-1">Stage</p>
          <Badge variant="info">{opportunity['stage'] as string}</Badge>
        </div>
        <div className="bg-surface-card rounded-xl border border-default p-4">
          <p className="text-xs text-secondary uppercase tracking-wide mb-1">Value</p>
          <p className="text-lg font-bold text-primary">
            {/* CRM-ROADMAP Phase 3, Feature 6: omitted (not present), not null, for a caller
                lacking OPPORTUNITY_VALUE_VIEW — show "—", not "₹NaN". */}
            {opportunity['value'] === undefined
              ? '—'
              : fmtCurrency(parseFloat(opportunity['value'] as string))}
          </p>
        </div>
        <div className="bg-surface-card rounded-xl border border-default p-4">
          <p className="text-xs text-secondary uppercase tracking-wide mb-1">Probability</p>
          <p className="text-lg font-bold text-primary">{opportunity['probability'] as number}%</p>
        </div>
      </div>

      <div className="bg-surface-card rounded-xl border border-default p-4 mb-4">
        <h3 className="text-sm font-semibold text-primary mb-3">Line Items</h3>
        {opportunity.lines.length === 0 ? (
          <p className="text-sm text-secondary mb-3">
            No line items yet — at least one is required before this deal can be marked Won.
          </p>
        ) : (
          <div className="space-y-2 mb-3">
            {opportunity.lines.map((l) => {
              const stock = stockByItem.get(l.itemId);
              return (
                <div
                  key={l.id}
                  className="flex items-center justify-between border-b border-default pb-2"
                >
                  <div>
                    <p className="text-sm text-primary">
                      Item #{l.itemId} — {l.quantity} × {fmtCurrency(parseFloat(l.unitPrice))}
                    </p>
                    {stock && (
                      <p className="text-xs text-secondary">
                        {stock.itemName}: {stock.totalAvailableQty} in stock across{' '}
                        {stock.warehouseCount} warehouse{stock.warehouseCount === 1 ? '' : 's'}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-primary">
                      {fmtCurrency(parseFloat(l.lineTotal))}
                    </span>
                    {canUpdate && (
                      <button
                        onClick={() => removeLineMutation.mutate(l.id)}
                        className="text-danger hover:opacity-70"
                        aria-label="Remove line item"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {canUpdate && (
          <div className="flex items-end gap-2">
            <Input
              label="Item ID"
              type="number"
              value={newLine.itemId}
              onChange={(e) => setNewLine((n) => ({ ...n, itemId: e.target.value }))}
              className="w-28"
            />
            <Input
              label="Quantity"
              type="number"
              value={newLine.quantity}
              onChange={(e) => setNewLine((n) => ({ ...n, quantity: e.target.value }))}
              className="w-28"
            />
            <Input
              label="Unit Price"
              type="number"
              step="0.01"
              value={newLine.unitPrice}
              onChange={(e) => setNewLine((n) => ({ ...n, unitPrice: e.target.value }))}
              className="w-32"
            />
            <Button size="sm" isLoading={addLineMutation.isPending} onClick={handleAddLine}>
              <Plus size={14} className="mr-1" /> Add
            </Button>
          </div>
        )}
      </div>

      <div className="bg-surface-card rounded-xl border border-default p-4">
        <h3 className="text-sm font-semibold text-primary mb-3">History</h3>
        {opportunity.history.length === 0 ? (
          <p className="text-sm text-secondary">No activity yet.</p>
        ) : (
          <div className="space-y-2">
            {opportunity.history.map((h) => (
              <div key={h.id} className="text-sm text-secondary">
                <span className="font-medium text-primary">{h.activityType}</span>
                {h.fromStage && h.toStage && ` — ${h.fromStage} → ${h.toStage}`}
                {h.notes && `: ${h.notes}`}
                <span className="text-xs ml-2">
                  {new Date(h.createdAt).toLocaleString('en-IN')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
