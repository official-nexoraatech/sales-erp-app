import { authFetch } from './auth.js';

// Routed through api-gateway rather than calling sales-service directly by port — see
// apps/web-frontend/src/api/client.ts's header comment for why.
const SALES_API = import.meta.env['VITE_SALES_API_URL'] ?? 'http://localhost:3000/api/sales';

const SESSION_ID_KEY = 'pos_session_id';

export interface PosSession {
  id: number;
  sessionNumber: string;
  branchId: number;
  warehouseId: number;
  status: 'OPEN' | 'CLOSED';
  openingCash: string;
  closingCash: string | null;
  expectedCash: string | null;
  cashVariance: string | null;
  totalSales: string;
  totalTransactions: number;
  openedAt: string;
  closedAt: string | null;
}

export function getActiveSessionId(): number | null {
  const raw = localStorage.getItem(SESSION_ID_KEY);
  return raw ? Number(raw) : null;
}

export function setActiveSessionId(id: number): void {
  localStorage.setItem(SESSION_ID_KEY, String(id));
}

export function clearActiveSessionId(): void {
  localStorage.removeItem(SESSION_ID_KEY);
}

// Used by the RequireSession route guard to recover "does this user already have an open
// session" after a page reload — the only other lookup is by numeric :id, which isn't known
// at that point.
//
// Distinguishes "the server confirmed no open session" from "the server is unreachable" —
// the two must not be treated the same, otherwise a cashier who reloads mid-outage would be
// bounced to /shift/open (which itself requires connectivity) instead of continuing to work
// offline against their already-known, locally-persisted session.
export type SessionCheckResult =
  { status: 'found'; session: PosSession } | { status: 'not-found' } | { status: 'offline' };

export async function fetchActiveSession(): Promise<SessionCheckResult> {
  try {
    const res = await authFetch(`${SALES_API}/pos/sessions/active`);
    if (!res.ok) return { status: 'not-found' };
    const body = (await res.json()) as { data: PosSession | null };
    return body.data ? { status: 'found', session: body.data } : { status: 'not-found' };
  } catch {
    return { status: 'offline' };
  }
}
