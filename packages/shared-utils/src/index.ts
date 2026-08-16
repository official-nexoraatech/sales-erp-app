export function formatIndianCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatIndianNumber(num: number): string {
  return new Intl.NumberFormat('en-IN').format(num);
}

export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

export function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d);
}

export function parseIndianDate(dateStr: string): Date {
  const [day, month, year] = dateStr.split('/').map(Number);
  if (!day || !month || !year) {
    throw new Error(`Invalid date format: ${dateStr}. Expected DD/MM/YYYY`);
  }
  return new Date(year, month - 1, day);
}

export function roundToDecimal(num: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(num * factor) / factor;
}

// Multi-vertical platform audit 2026-08-16: items had exactly one unit — no way to represent
// "buy a case of 24, sell/stock by the piece." An item's items.purchaseUnitConversionFactor
// says how many of its base/stock unit (items.unitId) make up one of its purchase unit
// (items.purchaseUnitId) — e.g. 24 for a 24-piece case. Undefined/null/<=0 means "no
// conversion configured," so callers should treat the item as unconverted (factor of 1),
// which is why this returns the input unchanged rather than throwing — most items will never
// set a purchase unit at all, and that must stay a true no-op, not an error path.
export function toBaseUnitQty(purchaseQty: number, conversionFactor?: number | null): number {
  if (!conversionFactor || conversionFactor <= 0) return purchaseQty;
  return roundToDecimal(purchaseQty * conversionFactor, 3);
}

export function fromBaseUnitQty(baseQty: number, conversionFactor?: number | null): number {
  if (!conversionFactor || conversionFactor <= 0) return baseQty;
  return roundToDecimal(baseQty / conversionFactor, 3);
}

export function calculateGst(
  taxableAmount: number,
  gstRate: number,
  isInterState: boolean
): {
  cgst: number;
  sgst: number;
  igst: number;
  totalGst: number;
  grandTotal: number;
} {
  const totalGst = roundToDecimal((taxableAmount * gstRate) / 100, 2);
  if (isInterState) {
    return { cgst: 0, sgst: 0, igst: totalGst, totalGst, grandTotal: taxableAmount + totalGst };
  }
  const halfGst = roundToDecimal(totalGst / 2, 2);
  return {
    cgst: halfGst,
    sgst: halfGst,
    igst: 0,
    totalGst,
    grandTotal: taxableAmount + totalGst,
  };
}

// ── GST Line Calculation (2026-07-31 audit consolidation) ──────────────────
// Previously duplicated independently across apps/sales-service, apps/purchase-service,
// apps/production-service (byte-identical to purchase's), and apps/gst-service's own
// GSTCalculator.ts files. The sales-service and purchase-service copies had genuinely
// diverged: sales used the flat discount amount whenever it was >0 (ignoring a
// simultaneously-set percentage), purchase/production took whichever of the two produced the
// larger discount — the same input line could produce a different taxable value depending on
// which service processed it. Product decision: a line may only ever set ONE of
// discountPct/discountAmount — enforced by Zod validation at every entity that accepts a line
// discount (Invoice/Quotation in sales-service; PO/GRN/PurchaseReturn in purchase-service;
// Reorder in production-service). computeLine() below assumes that invariant already holds
// (falls back to whichever field is non-zero) rather than re-validating it — validation is the
// call sites' responsibility, this is pure calculation.

export interface GstTaxSplitInput {
  taxableAmount: number;
  gstRate: number;
  cessRate?: number | undefined;
  isInterstate: boolean;
}

export interface GstTaxSplitResult {
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  cessRate: number;
  cessAmount: number;
  totalGst: number;
}

// The one CGST/SGST/IGST/CESS split primitive every GST-line calculation in this codebase
// (including gst-service's RCM self-assessment, which composes this directly) now shares.
export function splitGstTax(input: GstTaxSplitInput): GstTaxSplitResult {
  const cessRate = input.cessRate ?? 0;
  const cgstRate = input.isInterstate ? 0 : roundToDecimal(input.gstRate / 2, 2);
  const sgstRate = input.isInterstate ? 0 : roundToDecimal(input.gstRate / 2, 2);
  const igstRate = input.isInterstate ? input.gstRate : 0;
  const cgstAmount = roundToDecimal((input.taxableAmount * cgstRate) / 100, 2);
  const sgstAmount = roundToDecimal((input.taxableAmount * sgstRate) / 100, 2);
  const igstAmount = roundToDecimal((input.taxableAmount * igstRate) / 100, 2);
  const cessAmount = roundToDecimal((input.taxableAmount * cessRate) / 100, 2);
  const totalGst = roundToDecimal(cgstAmount + sgstAmount + igstAmount, 2);
  return {
    cgstRate,
    sgstRate,
    igstRate,
    cgstAmount,
    sgstAmount,
    igstAmount,
    cessRate,
    cessAmount,
    totalGst,
  };
}

export interface GSTLineInput {
  unitPrice: number;
  quantity: number;
  discountPct: number;
  discountAmount: number;
  gstRate: number;
  cessRate?: number | undefined;
  sellerStateCode: string;
  placeOfSupply: string;
}

export interface GSTLineResult {
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  gstRate: number;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  cessRate: number;
  cessAmount: number;
  lineTotal: number;
}

export interface GSTTotals {
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  cessAmount: number;
  grandTotal: number;
}

export class GSTCalculator {
  static computeLine(input: GSTLineInput): GSTLineResult {
    const subtotal = roundToDecimal(input.unitPrice * input.quantity, 2);
    const discountAmount =
      input.discountAmount > 0
        ? roundToDecimal(input.discountAmount, 2)
        : roundToDecimal(subtotal * (input.discountPct / 100), 2);
    const taxableAmount = roundToDecimal(subtotal - discountAmount, 2);

    const isInterstate = input.sellerStateCode !== input.placeOfSupply;
    const split = splitGstTax({
      taxableAmount,
      gstRate: input.gstRate,
      cessRate: input.cessRate,
      isInterstate,
    });
    const lineTotal = roundToDecimal(
      taxableAmount + split.cgstAmount + split.sgstAmount + split.igstAmount + split.cessAmount,
      2
    );

    return {
      subtotal,
      discountAmount,
      taxableAmount,
      gstRate: input.gstRate,
      cgstRate: split.cgstRate,
      sgstRate: split.sgstRate,
      igstRate: split.igstRate,
      cgstAmount: split.cgstAmount,
      sgstAmount: split.sgstAmount,
      igstAmount: split.igstAmount,
      cessRate: split.cessRate,
      cessAmount: split.cessAmount,
      lineTotal,
    };
  }

  static sumTotals(lines: GSTLineResult[]): GSTTotals {
    const subtotal = roundToDecimal(
      lines.reduce((s, l) => s + l.subtotal, 0),
      2
    );
    const discountAmount = roundToDecimal(
      lines.reduce((s, l) => s + l.discountAmount, 0),
      2
    );
    const taxableAmount = roundToDecimal(
      lines.reduce((s, l) => s + l.taxableAmount, 0),
      2
    );
    const cgstAmount = roundToDecimal(
      lines.reduce((s, l) => s + l.cgstAmount, 0),
      2
    );
    const sgstAmount = roundToDecimal(
      lines.reduce((s, l) => s + l.sgstAmount, 0),
      2
    );
    const igstAmount = roundToDecimal(
      lines.reduce((s, l) => s + l.igstAmount, 0),
      2
    );
    const cessAmount = roundToDecimal(
      lines.reduce((s, l) => s + l.cessAmount, 0),
      2
    );
    const grandTotal = roundToDecimal(
      taxableAmount + cgstAmount + sgstAmount + igstAmount + cessAmount,
      2
    );
    return {
      subtotal,
      discountAmount,
      taxableAmount,
      cgstAmount,
      sgstAmount,
      igstAmount,
      cessAmount,
      grandTotal,
    };
  }
}

export function maskPan(pan: string): string {
  return pan.slice(0, 2) + '•••••••' + pan.slice(-2);
}

export function maskGstin(gstin: string): string {
  return gstin.slice(0, 2) + '••••••••••••' + gstin.slice(-4);
}

export function maskBankAccount(accountNo: string): string {
  return '••••' + accountNo.slice(-4);
}

// CRM-ROADMAP Phase 1, Feature 1 (Contact & Account Hierarchy) / Feature 7 (Data Import/Dedupe/
// Merge Tooling) — the scored duplicate-account matching algorithm, shared between sales-service's
// AccountService (interactive create/merge-suggestion flow) and scheduler-service's ImportEngine
// (CSV import dedupe-preview) so both use exactly one implementation, same "one algorithm, not
// two" convention as matchesDltTemplate below.
export interface DuplicateMatchInput {
  name?: string | undefined;
  gstinHash?: string | undefined;
  phone?: string | undefined;
  email?: string | undefined;
}

export interface DuplicateMatchCandidate {
  name: string;
  gstinHash?: string | null | undefined;
  primaryPhone?: string | null | undefined;
  primaryEmail?: string | null | undefined;
}

export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Token-overlap (Jaccard) similarity — deliberately not a full edit-distance/fuzzy-string
// library: cheap, dependency-free, and good enough to distinguish "same company, different
// legal suffix" (e.g. "Sharma Textiles" vs "Sharma Textiles Pvt Ltd") from two unrelated
// companies that happen to share one common word.
function nameSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeName(a).split(' ').filter(Boolean));
  const tb = new Set(normalizeName(b).split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  const union = new Set([...ta, ...tb]).size;
  return union === 0 ? 0 : intersection / union;
}

// Below this, a candidate is never surfaced at all — keeps this an indexed-lookup-driven
// suggestion (gstin/phone/email exact match, optionally reinforced by name similarity), not
// a scored ranking of the entire tenant's account list.
export const DUPLICATE_MATCH_SUGGESTION_THRESHOLD = 40;

/**
 * Scores a single candidate account against normalized input (gstinHash/phone/email already
 * normalized by the caller — indexed-lookup callers fetch candidates via those exact fields, so
 * normalization must happen before the DB query, not just before scoring). Returns 0 (never
 * negative) when nothing matches; caller decides whether to surface below
 * `DUPLICATE_MATCH_SUGGESTION_THRESHOLD`.
 */
export function scoreDuplicateMatch(
  input: DuplicateMatchInput,
  candidate: DuplicateMatchCandidate
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  if (input.gstinHash && candidate.gstinHash === input.gstinHash) {
    score += 70;
    reasons.push('GSTIN matches an existing account');
  }
  if (input.phone && candidate.primaryPhone === input.phone) {
    score += 40;
    reasons.push('Phone number matches an existing account');
  }
  if (input.email && candidate.primaryEmail === input.email) {
    score += 30;
    reasons.push('Email matches an existing account');
  }
  if (input.name) {
    const similarity = nameSimilarity(input.name, candidate.name);
    if (similarity >= 0.5) {
      score += Math.round(similarity * 20);
      reasons.push('Similar account name');
    }
  }
  return { score: Math.min(100, score), reasons };
}

// CRM-ROADMAP Phase 1, Feature 6 (DLT/TRAI SMS Compliance) — shared between notification-service
// (the hard enforcement gate in NotificationEngine.sendRaw) and sales-service (the earlier,
// best-effort campaign creation/preview-time check) so both use exactly the same matching
// algorithm rather than two implementations drifting apart. A DLT-registered template's
// `{#var#}` placeholders become a wildcard; every other character is matched literally.
export function matchesDltTemplate(message: string, registeredPattern: string): boolean {
  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = registeredPattern.split('{#var#}').map(escapeRegex);
  const regex = new RegExp(`^${parts.join('.*')}$`, 's');
  return regex.test(message.trim());
}
