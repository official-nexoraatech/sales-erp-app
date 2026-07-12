import { formatIndianCurrency } from '@erp/utils';
import type { ApiError } from '../api/client.js';

export interface ErrorMessageContext {
  items?: { id: number; name: string }[];
  customerName?: string;
}

function toNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value);
}

// Item names are resolved from state already on screen (the line items just submitted)
// rather than a second lookup — same pattern as pos-frontend's posErrorMessages.ts.
function itemLabel(items: { id: number; name: string }[] | undefined, itemId: unknown): string {
  const id = toNumber(itemId);
  return items?.find((i) => i.id === id)?.name ?? `item #${itemId}`;
}

// Maps a backend ApiError (code + details) to staff-facing copy for the highest-traffic
// codes on invoice/stock/purchase forms. Falls back to the raw backend message for any
// code not yet mapped here — never a dead end, and safe to grow incrementally as more
// call sites adopt it (see PG-059 for the full cross-service rollout plan).
export function friendlyApiErrorMessage(
  error: Pick<ApiError, 'code' | 'message' | 'details'>,
  context: ErrorMessageContext = {}
): string {
  const d = error.details ?? {};

  switch (error.code) {
    case 'PRICE_FLOOR_VIOLATION': {
      const name = itemLabel(context.items, d['itemId']);
      const minPrice = toNumber(d['minPrice']);
      const offered = toNumber(d['offered']);
      return `${name} can't be sold below ${formatIndianCurrency(minPrice)} — entered ${formatIndianCurrency(offered)}.`;
    }

    case 'INSUFFICIENT_STOCK': {
      const name = itemLabel(context.items, d['itemId']);
      const available = toNumber(d['available']);
      const requested = toNumber(d['requested']);
      const requestedText = Number.isFinite(requested) ? ` — requested ${requested}` : '';
      return `Only ${Number.isFinite(available) ? available : 0} of ${name} in stock${requestedText}.`;
    }

    case 'CREDIT_LIMIT_EXCEEDED': {
      const limit = toNumber(d['limit']);
      const newBalance = toNumber(d['newBalance']);
      const who = context.customerName ?? 'This customer';
      return `${who} would exceed their credit limit of ${formatIndianCurrency(limit)} (new balance would be ${formatIndianCurrency(newBalance)}).`;
    }

    case 'VALIDATION_ERROR':
      return error.message || 'This form has invalid values — please check the highlighted fields.';

    case 'NOT_FOUND':
      return (
        error.message ||
        'The record you were looking for could not be found — it may have been deleted.'
      );

    default:
      return error.message || 'Something went wrong. Please try again.';
  }
}
