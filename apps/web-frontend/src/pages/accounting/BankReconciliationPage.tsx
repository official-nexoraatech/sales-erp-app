import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { bankReconciliationApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
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

export default function BankReconciliationPage() {
  const qc = useQueryClient();
  const [selectedItem, setSelectedItem] = useState<number | null>(null);

  const { data: itemsData, isLoading } = useQuery({
    queryKey: ['recon-items', BANK_ACCOUNT_ID],
    queryFn: () => bankReconciliationApi.getItems(BANK_ACCOUNT_ID),
  });

  const { data: summaryData } = useQuery({
    queryKey: ['recon-summary', BANK_ACCOUNT_ID],
    queryFn: () => bankReconciliationApi.getSummary(BANK_ACCOUNT_ID),
  });

  const items: ReconciliationItem[] = (itemsData as { data?: { content?: ReconciliationItem[] } })?.data?.content ?? [];
  const summary: Summary | undefined = (summaryData as { data?: Summary })?.data;

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
      <ERPPageHeader variant="list" title="Bank Reconciliation" subtitle="Match bank statement with book entries" />

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Bank Items', value: summary.totalBankItems, color: 'blue' },
            { label: 'Book Items', value: summary.totalBookItems, color: 'blue' },
            { label: 'Matched', value: summary.matchedItems, color: 'green' },
            { label: 'Unmatched', value: summary.unmatchedBankItems + summary.unmatchedBookItems, color: 'red' },
          ].map((s) => (
            <div key={s.label} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-center">
              <div className={`text-2xl font-bold text-${s.color}-600 dark:text-${s.color}-400`}>{s.value}</div>
              <div className="text-sm text-secondary mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {summary?.isReconciled && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-xl px-4 py-3 flex justify-between items-center">
          <span className="text-green-700 dark:text-green-300 font-medium">✓ All items matched — ready to finalize</span>
          <Button variant="primary" onClick={() => finalizeMutation.mutate(1)} disabled={finalizeMutation.isPending}>
            Finalize Reconciliation
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bank Side */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 font-semibold text-blue-700 dark:text-blue-400 text-sm">Bank Statement Items</div>
          {isLoading ? <ERPTableSkeleton rows={5} /> : (
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {bankItems.map((item) => (
                <div
                  key={item.id}
                  className={`px-4 py-3 cursor-pointer ${selectedItem === item.id ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-750'}`}
                  onClick={() => {
                    if (item.status !== 'UNMATCHED') return;
                    setSelectedItem(selectedItem === item.id ? null : item.id);
                  }}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-sm font-medium text-primary">{item.description}</div>
                      <div className="text-xs text-secondary">{formatDate(item.transactionDate)} {item.referenceNumber && `· Ref: ${item.referenceNumber}`}</div>
                    </div>
                    <div className="text-right">
                      {Number(item.debitAmount) > 0 && <div className="text-sm font-mono text-green-600">{formatCurrency(Number(item.debitAmount))}</div>}
                      {Number(item.creditAmount) > 0 && <div className="text-sm font-mono text-red-500">{formatCurrency(Number(item.creditAmount))}</div>}
                      <Badge label={item.status} color={item.status === 'MATCHED' ? 'green' : 'yellow'} />
                    </div>
                  </div>
                </div>
              ))}
              {bankItems.length === 0 && <div className="px-4 py-8 text-center text-secondary text-sm">No bank items</div>}
            </div>
          )}
        </div>

        {/* Book Side */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 font-semibold text-purple-700 dark:text-purple-400 text-sm">Book Entries</div>
          {isLoading ? <ERPTableSkeleton rows={5} /> : (
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {bookItems.map((item) => (
                <div
                  key={item.id}
                  className={`px-4 py-3 ${selectedItem && item.status === 'UNMATCHED' ? 'cursor-pointer hover:bg-purple-50 dark:hover:bg-purple-900/10' : ''}`}
                  onClick={() => {
                    if (selectedItem && item.status === 'UNMATCHED') {
                      matchMutation.mutate({ itemId: selectedItem, matchedItemId: item.id });
                    }
                  }}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-sm font-medium text-primary">{item.description}</div>
                      <div className="text-xs text-secondary">{formatDate(item.transactionDate)}</div>
                    </div>
                    <div className="text-right">
                      {Number(item.debitAmount) > 0 && <div className="text-sm font-mono text-green-600">{formatCurrency(Number(item.debitAmount))}</div>}
                      {Number(item.creditAmount) > 0 && <div className="text-sm font-mono text-red-500">{formatCurrency(Number(item.creditAmount))}</div>}
                      <Badge label={item.status} color={item.status === 'MATCHED' ? 'green' : 'yellow'} />
                    </div>
                  </div>
                </div>
              ))}
              {bookItems.length === 0 && <div className="px-4 py-8 text-center text-secondary text-sm">No book items</div>}
            </div>
          )}
        </div>
      </div>

      {selectedItem && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-6 py-3 rounded-xl shadow-lg text-sm font-medium">
          Item #{selectedItem} selected — click a book entry to match it
          <button className="ml-4 underline" onClick={() => setSelectedItem(null)}>Cancel</button>
        </div>
      )}
    </div>
  );
}
