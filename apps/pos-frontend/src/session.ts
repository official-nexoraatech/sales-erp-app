import { authFetch } from './auth.js';

const SALES_API = import.meta.env['VITE_SALES_API_URL'] ?? 'http://localhost:3013/api/v2';

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
export async function fetchActiveSession(): Promise<PosSession | null> {
  const res = await authFetch(`${SALES_API}/pos/sessions/active`);
  if (!res.ok) return null;
  const body = (await res.json()) as { data: PosSession | null };
  return body.data;
}
