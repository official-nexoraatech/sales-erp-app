import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../../hooks/useOnlineStatus.js';

/** App-wide connectivity banner — previously the only offline signal anywhere in this app
 * was ERPCommandPalette's own scoped empty state, so a logged-in user got no indication of
 * lost connectivity until an individual request failed (see
 * WEB-FRONTEND-AUDIT-2026-07-24.md, High #7). Mounted once, inside the authenticated shell. */
export default function OfflineBanner() {
  const online = useOnlineStatus();
  if (online) return null;

  return (
    <div className="flex items-center justify-center gap-2 px-4 py-2 bg-danger text-white text-sm font-medium shrink-0">
      <WifiOff size={16} className="shrink-0" />
      You're offline — changes won't save until your connection is back.
    </div>
  );
}
