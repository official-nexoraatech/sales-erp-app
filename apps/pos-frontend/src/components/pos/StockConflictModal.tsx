import { useState, useEffect } from 'react';
import { getCatalogItemById } from '../../localStore.js';
import type { PendingSale } from '../../db.js';
import POSDialog from './POSDialog.js';
import POSButton from './POSButton.js';

// OFFLINE-07: resolution UI for stock-conflict stuck sales — shows the queued vs currently
// available quantity per conflicting item, with adjust-and-retry / cancel actions. Extends
// SyncStatusPanel's stuck-item surface rather than a parallel mechanism.
export function StockConflictModal({
  conflicts, onResolve, onClose,
}: {
  conflicts: PendingSale[];
  onResolve: (id: number, action: 'adjust' | 'cancel') => void;
  onClose: () => void;
}) {
  const [itemNames, setItemNames] = useState<Record<number, string>>({});

  useEffect(() => {
    let cancelled = false;
    const ids = Array.from(new Set(conflicts.map((c) => c.conflict!.itemId)));
    void Promise.all(ids.map(async (id) => [id, (await getCatalogItemById(id))?.name] as const)).then((entries) => {
      if (cancelled) return;
      setItemNames(Object.fromEntries(entries.filter(([, name]) => name) as [number, string][]));
    });
    return () => { cancelled = true; };
  }, [conflicts]);

  return (
    <POSDialog open title="Stock Conflicts" onClose={onClose} size="md">
      <p className="text-sm text-secondary mb-3">
        Stock changed since these sales were queued offline. Adjust to what's available and retry, or cancel.
      </p>
      {conflicts.length === 0 ? (
        <p className="text-sm text-disabled text-center py-6">No stock conflicts</p>
      ) : (
        <div className="space-y-2">
          {conflicts.map((c) => {
            const conflict = c.conflict!;
            const name = itemNames[conflict.itemId] ?? `Item #${conflict.itemId}`;
            return (
              <div key={c.id} className="bg-surface-subtle rounded-xl p-3">
                <div className="text-sm font-medium text-primary">{name}</div>
                <div className="text-xs text-secondary">
                  Queued: {conflict.requested} &nbsp;•&nbsp; Available now: {conflict.available}
                </div>
                <div className="flex gap-2 mt-2">
                  <POSButton size="sm" variant="primary" onClick={() => onResolve(c.id!, 'adjust')}>
                    Adjust to {conflict.available} & retry
                  </POSButton>
                  <POSButton size="sm" variant="secondary" onClick={() => onResolve(c.id!, 'cancel')}>
                    Cancel sale
                  </POSButton>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </POSDialog>
  );
}
