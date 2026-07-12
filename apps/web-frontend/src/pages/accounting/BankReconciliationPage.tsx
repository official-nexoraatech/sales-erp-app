import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { bankReconciliationApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import { formatCurrency, formatDate } from '../../lib/format.js';

interface ReconciliationItem {
  id: number;
  itemType: 'BANK' | 'BOOK';
  transactionDate: string;
  description: string;
  debitAmount: string;
  creditAmount: string;
  referenceNumber?: string;
  status: 'UNMATCHED' | 'MATCHED' | 'CLEARED';
  matchedItemId?: number;
}

interface Summary {
  totalBankItems: number;
  totalBookItems: number;
  matchedItems: number;
  unmatchedBankItems: number;
  unmatchedBookItems: number;
  isReconciled: boolean;
}

const BANK_ACCOUNT_ID = 1; // Demo — in production, use a dropdown to select bank account

const STAT_COLOR_CLASSES: Record<string, string> = {
  blue: 'text-info',
  green: 'text-success',
  red: 'text-danger',
};

export default function BankReconciliationPage() {
  const qc = useQueryClient();
  const canReconcile = useAuthStore((s) => s.hasPermission(PERMISSIONS.BANK_RECONCILIATION_DO));
  const [selectedItem, setSelectedItem] = useState<number | null>(null);

  const { data: itemsData, isLoading } = useQuery({
    queryKey: ['recon-items', BANK_ACCOUNT_ID],
    queryFn: () => bankReconciliationApi.getItems(BANK_ACCOUNT_ID),
  });

  const { data: summaryData } = useQuery({
    queryKey: ['recon-summary', BANK_ACCOUNT_ID],
    queryFn: () => bankReconciliationApi.getSummary(BANK_ACCOUNT_ID),
  });

  const items: ReconciliationItem[] =
    (itemsData as { content?: ReconciliationItem[] })?.content ?? [];
  const summary: Summary | undefined = summaryData as Summary;

  const matchMutation = useMutation({
    mutationFn: ({ itemId, matchedItemId }: { itemId: number; matchedItemId: number }) =>
      bankReconciliationApi.matchItem(BANK_ACCOUNT_ID, itemId, { matchedItemId }),
    onSuccess: () => {
      toast.success('Items matched');
      setSelectedItem(null);
      qc.invalidateQueries({ queryKey: ['recon-items'] });
      qc.invalidateQueries({ queryKey: ['recon-summary'] });
    },
    onError: () => toast.error('Match failed'),
  });

  const finalizeMutation = useMutation({
    mutationFn: (statementId: number) =>
      bankReconciliationApi.finalize(BANK_ACCOUNT_ID, { statementId }),
    onSuccess: () => toast.success('Reconciliation finalized'),
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : 'Finalize failed'),
  });

  const bankItems = items.filter((i) => i.itemType === 'BANK');
  const bookItems = items.filter((i) => i.itemType === 'BOOK');

  return (
    <div className="space-y-6">
      <ERPPageHeader
        variant="list"
        title="Bank Reconciliation"
        subtitle="Match bank statement with book entries"
      />

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Bank Items', value: summary.totalBankItems, color: 'blue' },
            { label: 'Book Items', value: summary.totalBookItems, color: 'blue' },
            { label: 'Matched', value: summary.matchedItems, color: 'green' },
            {
              label: 'Unmatched',
              value: summary.unmatchedBankItems + summary.unmatchedBookItems,
              color: 'red',
            },
          ].map((s) => (
            <div
              key={s.label}
              className="bg-surface-card rounded-xl border border-default p-4 text-center"
            >
              <div
                className={`text-2xl font-bold ${STAT_COLOR_CLASSES[s.color] ?? 'text-primary'}`}
              >
                {s.value}
              </div>
              <div className="text-sm text-secondary mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {canReconcile && summary?.isReconciled && (
        <div className="bg-success-bg border border-success rounded-xl px-4 py-3 flex flex-wrap justify-between items-center gap-2">
          <span className="text-success font-medium">✓ All items matched — ready to finalize</span>
          <Button
            variant="primary"
            onClick={() => finalizeMutation.mutate(1)}
            disabled={finalizeMutation.isPending}
          >
            Finalize Reconciliation
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bank Side */}
        <div className="bg-surface-card rounded-xl border border-default">
          <div className="px-4 py-3 border-b border-default font-semibold text-info text-sm">
            Bank Statement Items
          </div>
          {isLoading ? (
            <ERPTableSkeleton rows={5} />
          ) : (
            <div className="divide-y divide-default">
              {bankItems.map((item) => (
                <div
                  key={item.id}
                  className={`px-4 py-3 ${canReconcile ? 'cursor-pointer' : ''} ${selectedItem === item.id ? 'bg-info-bg' : 'hover:bg-surface-raised'}`}
                  onClick={() => {
                    if (!canReconcile || item.status !== 'UNMATCHED') return;
                    setSelectedItem(selectedItem === item.id ? null : item.id);
                  }}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-sm font-medium text-primary">{item.description}</div>
                      <div className="text-xs text-secondary">
                        {formatDate(item.transactionDate)}{' '}
                        {item.referenceNumber && `· Ref: ${item.referenceNumber}`}
                      </div>
                    </div>
                    <div className="text-right">
                      {Number(item.debitAmount) > 0 && (
                        <div className="text-sm font-mono text-success">
                          {formatCurrency(Number(item.debitAmount))}
                        </div>
                      )}
                      {Number(item.creditAmount) > 0 && (
                        <div className="text-sm font-mono text-danger">
                          {formatCurrency(Number(item.creditAmount))}
                        </div>
                      )}
                      <Badge
                        label={item.status}
                        color={item.status === 'MATCHED' ? 'green' : 'yellow'}
                      />
                    </div>
                  </div>
                </div>
              ))}
              {bankItems.length === 0 && (
                <ERPEmptyState
                  type="no-data"
                  title="No bank items"
                  description="Bank statement items will appear here once imported."
                />
              )}
            </div>
          )}
        </div>

        {/* Book Side */}
        <div className="bg-surface-card rounded-xl border border-default">
          <div className="px-4 py-3 border-b border-default font-semibold text-brand text-sm">
            Book Entries
          </div>
          {isLoading ? (
            <ERPTableSkeleton rows={5} />
          ) : (
            <div className="divide-y divide-default">
              {bookItems.map((item) => (
                <div
                  key={item.id}
                  className={`px-4 py-3 ${selectedItem && item.status === 'UNMATCHED' ? 'cursor-pointer hover:bg-primary-subtle' : ''}`}
                  onClick={() => {
                    if (selectedItem && item.status === 'UNMATCHED') {
                      matchMutation.mutate({ itemId: selectedItem, matchedItemId: item.id });
                    }
                  }}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-sm font-medium text-primary">{item.description}</div>
                      <div className="text-xs text-secondary">
                        {formatDate(item.transactionDate)}
                      </div>
                    </div>
                    <div className="text-right">
                      {Number(item.debitAmount) > 0 && (
                        <div className="text-sm font-mono text-success">
                          {formatCurrency(Number(item.debitAmount))}
                        </div>
                      )}
                      {Number(item.creditAmount) > 0 && (
                        <div className="text-sm font-mono text-danger">
                          {formatCurrency(Number(item.creditAmount))}
                        </div>
                      )}
                      <Badge
                        label={item.status}
                        color={item.status === 'MATCHED' ? 'green' : 'yellow'}
                      />
                    </div>
                  </div>
                </div>
              ))}
              {bookItems.length === 0 && (
                <ERPEmptyState
                  type="no-data"
                  title="No book items"
                  description="Book entries will appear here once posted."
                />
              )}
            </div>
          )}
        </div>
      </div>

      {selectedItem && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 max-w-[92vw] bg-primary text-primary-fg px-6 py-3 rounded-xl shadow-lg text-sm font-medium">
          Item #{selectedItem} selected — click a book entry to match it
          <button className="ml-4 underline" onClick={() => setSelectedItem(null)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
