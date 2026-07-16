// OFFLINE-06: sync logic safe to run inside the service worker (no `window`/`localStorage`
// access), used by sw.ts's `sync` event handler. Reuses the same queue primitives
// (offlineDb.ts) that POSScreen.tsx's page-context sync uses — the operationId dedupe /
// retry / stuck-transition logic that actually prevents duplicate invoices lives in one
// place regardless of which context triggered the sync. Only the network-calling loop and
// auth handling are separate, since auth.ts's authFetch depends on localStorage and
// window.location (both unavailable here) and needs different failure handling: a stale
// token/refresh-token here just means the sync attempt fails and the item stays queued for
// the next attempt, rather than forcing a page redirect that a service worker can't do.
import {
  getPendingSales,
  deletePendingSale,
  incrementRetries,
  getPendingCustomers,
  deletePendingCustomer,
  incrementCustomerRetries,
  rewritePendingSalesCustomerId,
} from './offlineDb.js';
import { upsertCustomers, deleteCustomerById, setSyncMeta } from './localStore.js';
import { getMirroredTokens, mirrorTokens } from './tokenStore.js';
import type { CachedCustomer } from './db.js';

// Routed through api-gateway rather than calling services directly by port — see
// apps/web-frontend/src/api/client.ts's header comment for why.
const AUTH_API = (import.meta.env['VITE_AUTH_API_URL'] ?? 'http://localhost:3000') + '/api/auth';
const SALES_API = import.meta.env['VITE_SALES_API_URL'] ?? 'http://localhost:3000/api/sales';

export const PENDING_SYNC_META_STORE = 'pendingSync';

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  try {
    const res = await fetch(`${AUTH_API}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { accessToken: string; refreshToken: string };
    await mirrorTokens(body.accessToken, body.refreshToken);
    return body.accessToken;
  } catch {
    return null;
  }
}

function refreshOnce(refreshToken: string): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = refreshAccessToken(refreshToken).finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function swFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const tokens = await getMirroredTokens();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${tokens?.accessToken ?? ''}`);
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json');

  const res = await fetch(url, { ...init, headers });
  if (res.status === 401 && tokens?.refreshToken) {
    const newToken = await refreshOnce(tokens.refreshToken);
    if (newToken) {
      headers.set('Authorization', `Bearer ${newToken}`);
      return fetch(url, { ...init, headers });
    }
  }
  return res;
}

// Mirrors POSScreen.tsx's syncPendingCustomers loop exactly (same success/failure handling),
// minus the React state updates (setCustomer, toasts) that only make sense with a mounted page.
async function syncPendingCustomersSW(): Promise<number> {
  const pending = (await getPendingCustomers()).filter((p) => p.status !== 'stuck');
  let synced = 0;
  for (const c of pending) {
    try {
      const res = await swFetch(`${SALES_API}/customers`, {
        method: 'POST',
        body: JSON.stringify({ ...c.payload, operationId: c.operationId }),
      });
      if (res.ok) {
        const body = (await res.json()) as { data: CachedCustomer & { id: number } };
        const real = body.data;
        await deleteCustomerById(c.localCustomerId);
        await upsertCustomers([
          {
            id: real.id,
            tenantId: real.tenantId,
            branchId: real.branchId,
            displayName: real.displayName,
            phone: real.phone,
            ...(real.altPhone !== undefined ? { altPhone: real.altPhone } : {}),
            ...(real.email !== undefined ? { email: real.email } : {}),
            customerType: real.customerType,
            updatedAt:
              typeof real.updatedAt === 'string'
                ? real.updatedAt
                : new Date(real.updatedAt).toISOString(),
          },
        ]);
        await rewritePendingSalesCustomerId(c.localCustomerId, real.id);
        await deletePendingCustomer(c.id!);
        synced++;
      } else {
        await incrementCustomerRetries(c.id!);
      }
    } catch {
      await incrementCustomerRetries(c.id!);
    }
  }
  return synced;
}

// Mirrors POSScreen.tsx's syncPending loop exactly (same success/failure handling).
async function syncPendingSalesSW(): Promise<number> {
  const pending = (await getPendingSales()).filter((p) => p.status !== 'stuck');
  let synced = 0;
  for (const sale of pending) {
    try {
      const res = await swFetch(`${SALES_API}/pos/sales`, {
        method: 'POST',
        body: JSON.stringify({ ...sale.payload, operationId: sale.operationId }),
      });
      if (res.ok) {
        await deletePendingSale(sale.id!);
        synced++;
      } else {
        await incrementRetries(sale.id!);
      }
    } catch {
      await incrementRetries(sale.id!);
    }
  }
  return synced;
}

export interface BackgroundSyncResult {
  syncedSales: number;
  syncedCustomers: number;
}

// Customers before sales, matching POSScreen.tsx's ordering — a queued sale may reference a
// customer created offline, and its placeholder id needs rewriting before the sale syncs.
export async function runBackgroundSync(): Promise<BackgroundSyncResult> {
  const tokens = await getMirroredTokens();
  if (!tokens) return { syncedSales: 0, syncedCustomers: 0 };

  const syncedCustomers = await syncPendingCustomersSW();
  const syncedSales = await syncPendingSalesSW();
  if (syncedSales > 0 || syncedCustomers > 0) {
    await setSyncMeta({ store: PENDING_SYNC_META_STORE, lastSyncedAt: Date.now() });
  }
  return { syncedSales, syncedCustomers };
}
