import type { CartItem, Customer } from './components/pos/types.js';

export interface BackendError {
  code?: string;
  message?: string;
  details?: Record<string, unknown>;
}

function formatCurrency(n: number): string {
  return Number.isFinite(n) ? `₹${n.toFixed(2)}` : '₹0.00';
}

function toNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value);
}

// Item/customer names are resolved from state already in memory (the cart just submitted,
// the customer already selected) — no extra API round-trip needed to turn a raw itemId
// back into something a cashier recognizes.
function itemName(cart: CartItem[], itemId: unknown): string {
  const id = toNumber(itemId);
  return cart.find((l) => l.itemId === id)?.itemName ?? `item #${itemId}`;
}

// Cross-cutting backend error codes that can surface from any endpoint, not just
// POST /pos/sales — every service's requirePermission()/requireAnyPermission() middleware
// throws a 403 with code 'FORBIDDEN' and a raw `Missing permission: X` message (see
// apps/sales-service/src/middleware/authorize.ts). That string is meant for logs/API
// consumers, not a cashier, so translate it before it ever reaches a toast.
const GENERIC_ERROR_MESSAGES: Record<string, string> = {
  FORBIDDEN: "You don't have permission to do this. Ask your manager or admin for access.",
  PERMISSION_DENIED: "You don't have permission to do this. Ask your manager or admin for access.",
  UNAUTHORIZED: 'Your session has expired. Please sign in again.',
};

// Generic counterpart to friendlySaleErrorMessage below, for screens that aren't the
// sale-submission flow (shift open/close, drawer, customer quick-add). Translates known
// cross-cutting codes; anything else falls back to the raw backend message rather than a
// dead end, same convention as friendlySaleErrorMessage.
export function friendlyErrorMessage(error: BackendError | undefined, fallback: string): string {
  if (error?.code && GENERIC_ERROR_MESSAGES[error.code]) {
    return GENERIC_ERROR_MESSAGES[error.code]!;
  }
  return error?.message ?? fallback;
}

// Maps a POST /pos/sales error response to cashier-facing copy. Falls back to the raw
// backend message for any code not yet mapped here — never a dead end, and safe to grow
// this table incrementally as new cases come up (see PG-059 for the rest of the rollout).
export function friendlySaleErrorMessage(
  error: BackendError,
  cart: CartItem[],
  customer: Customer | null
): string {
  const d = error.details ?? {};

  switch (error.code) {
    case 'PRICE_FLOOR_VIOLATION': {
      const name = itemName(cart, d['itemId']);
      const minPrice = toNumber(d['minPrice']);
      const offered = toNumber(d['offered']);
      return `${name} can't be sold below ${formatCurrency(minPrice)} — you entered ${formatCurrency(offered)}. Update the price to continue.`;
    }

    case 'INSUFFICIENT_STOCK': {
      const name = itemName(cart, d['itemId']);
      const available = toNumber(d['available']);
      const requested = toNumber(d['requested']);
      const requestedText = Number.isFinite(requested)
        ? ` — you're trying to sell ${requested}`
        : '';
      return `Only ${Number.isFinite(available) ? available : 0} of ${name} left in stock${requestedText}. Reduce the quantity or restock.`;
    }

    case 'CREDIT_LIMIT_EXCEEDED': {
      const limit = toNumber(d['limit']);
      const newBalance = toNumber(d['newBalance']);
      const who = customer?.displayName ?? 'this customer';
      const over =
        Number.isFinite(limit) && Number.isFinite(newBalance)
          ? formatCurrency(newBalance - limit)
          : 'the';
      return `This sale would put ${who} ${over} over their ${formatCurrency(limit)} credit limit. Collect payment or get manager approval.`;
    }

    case 'INSUFFICIENT_POINTS': {
      const available = toNumber(d['available']);
      const who = customer?.displayName ?? 'This customer';
      return `${who} only has ${Number.isFinite(available) ? available : 0} loyalty points — lower the redeem amount.`;
    }

    case 'DISCOUNT_LIMIT_EXCEEDED':
      return (
        error.message ?? 'Discounts above the limit need manager approval to complete this sale.'
      );

    case 'PAYMENT_MISMATCH':
      return (
        error.message ?? "The amount collected doesn't match what's due — check the payment split."
      );

    case 'NO_OPEN_SESSION':
      return "Your till isn't open yet — go back and open a shift before selling.";

    case 'BRANCH_ACCESS_DENIED':
      return "You don't have access to sell from this branch. Contact your admin.";

    case 'DUPLICATE_OPERATION_PROCESSING':
      return 'This sale is already being saved — wait a moment and check if it went through before retrying.';

    case 'VALIDATION_ERROR':
      return `Something in this sale looks invalid${error.message ? `: ${error.message}` : ''}. Please check the cart and try again.`;

    default:
      return friendlyErrorMessage(error, 'Sale failed');
  }
}
