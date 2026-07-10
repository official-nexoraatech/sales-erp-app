import { AlertTriangle } from 'lucide-react';
import { ConnectivityDot, formatLastSync } from '../../ConnectivityStatus.js';

export function SyncStatusPanel({
  online, pendingCount, stuckCount, conflictCount, lastSyncedAt, onSyncNow, onRetryStuck, onShowConflicts,
}: {
  online: boolean;
  pendingCount: number;
  stuckCount: number;
  conflictCount: number;
  lastSyncedAt: number | null;
  onSyncNow: () => void;
  onRetryStuck: () => void;
  onShowConflicts: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <ConnectivityDot online={online} pendingCount={pendingCount} />
      <span className="text-xs text-secondary" title="Last successful background/manual sync">
        Last sync: {formatLastSync(lastSyncedAt)}
      </span>
      {online && pendingCount > 0 && (
        <button onClick={onSyncNow} className="text-xs font-medium text-link hover:text-[var(--text-link-hover)] underline">
          Sync now
        </button>
      )}
      {conflictCount > 0 && (
        <button
          onClick={onShowConflicts}
          className="flex items-center gap-1 text-xs font-medium text-warning hover:text-[var(--color-warning-hover)] underline"
          title="Stock changed since these sales were queued offline — review and resolve"
        >
          <AlertTriangle size={12} />
          {conflictCount} stock conflict{conflictCount > 1 ? 's' : ''} — Resolve
        </button>
      )}
      {stuckCount > 0 && (
        <button
          onClick={onRetryStuck}
          className="flex items-center gap-1 text-xs font-medium text-danger hover:text-[var(--color-danger-hover)] underline"
          title="These sales failed to sync repeatedly — click to reset and retry"
        >
          <AlertTriangle size={12} />
          {stuckCount} item{stuckCount > 1 ? 's' : ''} need attention — Retry
        </button>
      )}
    </div>
  );
}
