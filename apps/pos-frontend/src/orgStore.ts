import { authFetch } from './auth.js';

const SELLER_STATE_CODE_KEY = 'pos_seller_state_code';

// Routed through api-gateway rather than calling tenant-service directly by port — see
// apps/web-frontend/src/api/client.ts's header comment for why.
const TENANT_API = import.meta.env['VITE_TENANT_API_URL'] ?? 'http://localhost:3000/api/tenant';

// Compliance audit: POSScreen's salePayload() used to hardcode placeOfSupply/sellerStateCode
// to '27' (Maharashtra) for every sale, regardless of the tenant's actual registered state —
// any non-Maharashtra tenant got wrong CGST/SGST-vs-IGST splitting on every POS sale. The
// correct value is derived from the tenant's own GSTIN (first two digits are the state code,
// same derivation gst-service's GstLedgerService.extractStateCode() uses server-side) and
// cached in localStorage — same convention as branchStore.ts — so it's still available for
// offline sales after the first successful fetch, unlike an in-memory-only query cache.
export function getCachedSellerStateCode(): string | null {
  return localStorage.getItem(SELLER_STATE_CODE_KEY);
}

export function setCachedSellerStateCode(code: string): void {
  localStorage.setItem(SELLER_STATE_CODE_KEY, code);
}

// Fetches and caches the seller state code. Called both by POSScreen's periodic background
// refresh and — critically — by ShiftOpenScreen right after a shift opens, since that's an
// inherently online moment (opening a shift requires a live POST). A brand-new device that's
// never been online long enough for POSScreen's own query to complete would otherwise reach
// salePayload() with no cached code at all; without this, that path fell back to a hardcoded
// '27' (Maharashtra) — reintroducing, for exactly that bootstrap window, the same wrong-state
// compliance bug this cache was built to fix. Best-effort: swallows failures so a flaky
// secondary endpoint never blocks shift-open or sale completion.
export async function refreshCachedSellerStateCode(): Promise<string | null> {
  try {
    const res = await authFetch(`${TENANT_API}/organization`);
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { gstin?: string | null } };
    const gstin = body.data?.gstin;
    if (!gstin || gstin.length < 2) return null;
    const code = gstin.substring(0, 2);
    setCachedSellerStateCode(code);
    return code;
  } catch {
    return null;
  }
}
