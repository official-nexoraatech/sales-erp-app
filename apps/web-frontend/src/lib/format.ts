// ── Number formatting ─────────────────────────────────────────────────────────
const inNumberFmt = new Intl.NumberFormat('en-IN');
const inCurrencyFmt = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const inCurrencyCompactFmt = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function formatNumber(value: number): string {
  return inNumberFmt.format(value);
}

export function formatCurrency(value: number): string {
  return inCurrencyFmt.format(value);
}

export function formatCurrencyCompact(value: number): string {
  return inCurrencyCompactFmt.format(value);
}

export function formatPercent(value: number, decimals = 2): string {
  return `${value.toFixed(decimals)}%`;
}

// ── Date formatting ───────────────────────────────────────────────────────────
const dateDisplayFmt = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});
const datetimeDisplayFmt = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '–';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (isNaN(d.getTime())) return '–';
  return dateDisplayFmt.format(d);
}

export function formatDatetime(value: string | Date | null | undefined): string {
  if (!value) return '–';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (isNaN(d.getTime())) return '–';
  return datetimeDisplayFmt.format(d);
}

export function formatDateISO(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

/** Returns a relative label like "2 hours ago", "in 3 days", etc. */
export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return '–';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (isNaN(d.getTime())) return '–';
  const diffMs = d.getTime() - Date.now();
  const diffSec = Math.round(diffMs / 1000);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (Math.abs(diffSec) < 60) return rtf.format(diffSec, 'second');
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, 'minute');
  const diffHr = Math.round(diffMin / 60);
  if (Math.abs(diffHr) < 24) return rtf.format(diffHr, 'hour');
  const diffDay = Math.round(diffHr / 24);
  if (Math.abs(diffDay) < 30) return rtf.format(diffDay, 'day');
  const diffMon = Math.round(diffDay / 30);
  if (Math.abs(diffMon) < 12) return rtf.format(diffMon, 'month');
  return rtf.format(Math.round(diffMon / 12), 'year');
}

// ── Phone / GST formatting ────────────────────────────────────────────────────
export function formatPhone(value: string | null | undefined): string {
  if (!value) return '–';
  const digits = value.replace(/\D/g, '');
  if (digits.length === 10) return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  return value;
}

export function formatGST(value: string | null | undefined): string {
  if (!value) return '–';
  return value.toUpperCase();
}

// ── Quantity formatting ───────────────────────────────────────────────────────
export function formatQty(value: number, unit?: string): string {
  const num = inNumberFmt.format(value);
  return unit ? `${num} ${unit}` : num;
}

// ── Fallback dash ─────────────────────────────────────────────────────────────
export function orDash(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '–';
  return String(value);
}
