// Shared online/offline + last-sync display, extracted from POSScreen so OFFLINE-09's
// LookupScreen shows the same staleness convention instead of inventing a new one.

export function ConnectivityDot({ online, pendingCount }: { online: boolean; pendingCount: number }) {
  const color = !online ? 'bg-danger' : pendingCount > 0 ? 'bg-warning' : 'bg-success';
  const textColor = !online ? 'text-danger' : pendingCount > 0 ? 'text-warning' : 'text-success';
  const label = !online ? 'Offline' : pendingCount > 0 ? `${pendingCount} pending sync` : 'Online';
  return (
    <div className="flex items-center gap-2 text-xs font-medium">
      <span className={`inline-block w-2.5 h-2.5 rounded-full ${color} animate-pulse`} />
      <span className={textColor}>{label}</span>
    </div>
  );
}

export function formatLastSync(ts: number | null): string {
  if (ts === null) return 'never';
  const diffMs = Date.now() - ts;
  if (diffMs < 60_000) return 'just now';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(ts).toLocaleDateString();
}
