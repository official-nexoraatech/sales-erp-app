const SELLER_STATE_CODE_KEY = 'pos_seller_state_code';

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
