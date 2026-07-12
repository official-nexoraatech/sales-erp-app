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

export function maskPan(pan: string): string {
  return pan.slice(0, 2) + '•••••••' + pan.slice(-2);
}

export function maskGstin(gstin: string): string {
  return gstin.slice(0, 2) + '••••••••••••' + gstin.slice(-4);
}

export function maskBankAccount(accountNo: string): string {
  return '••••' + accountNo.slice(-4);
}
