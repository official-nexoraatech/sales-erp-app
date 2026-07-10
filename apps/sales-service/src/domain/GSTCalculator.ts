export interface GSTLineInput {
  unitPrice: number;
  quantity: number;
  discountPct: number;
  discountAmount: number;
  gstRate: number;
  cessRate?: number;
  sellerStateCode: string;
  placeOfSupply: string;
}

export interface GSTLineResult {
  taxableAmount: number;
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
    const subtotal = round2(input.unitPrice * input.quantity);
    const discount = input.discountAmount > 0
      ? round2(input.discountAmount)
      : round2(subtotal * (input.discountPct / 100));
    const taxableAmount = round2(subtotal - discount);

    const isIntraState = input.sellerStateCode === input.placeOfSupply;
    const cgstRate = isIntraState ? round2(input.gstRate / 2) : 0;
    const sgstRate = isIntraState ? round2(input.gstRate / 2) : 0;
    const igstRate = isIntraState ? 0 : input.gstRate;
    const cessRate = input.cessRate ?? 0;

    const cgstAmount = round2(taxableAmount * cgstRate / 100);
    const sgstAmount = round2(taxableAmount * sgstRate / 100);
    const igstAmount = round2(taxableAmount * igstRate / 100);
    const cessAmount = round2(taxableAmount * cessRate / 100);
    const lineTotal = round2(taxableAmount + cgstAmount + sgstAmount + igstAmount + cessAmount);

    return { taxableAmount, cgstRate, sgstRate, igstRate, cgstAmount, sgstAmount, igstAmount, cessRate, cessAmount, lineTotal };
  }

  static sumTotals(lines: Array<{ unitPrice: number; quantity: number; discountPct: number; discountAmount: number } & GSTLineResult>): GSTTotals {
    let subtotal = 0, discountAmount = 0, taxableAmount = 0;
    let cgstAmount = 0, sgstAmount = 0, igstAmount = 0, cessAmount = 0, grandTotal = 0;

    for (const l of lines) {
      subtotal = round2(subtotal + l.unitPrice * l.quantity);
      discountAmount = round2(discountAmount + (l.discountAmount > 0 ? l.discountAmount : l.unitPrice * l.quantity * l.discountPct / 100));
      taxableAmount = round2(taxableAmount + l.taxableAmount);
      cgstAmount = round2(cgstAmount + l.cgstAmount);
      sgstAmount = round2(sgstAmount + l.sgstAmount);
      igstAmount = round2(igstAmount + l.igstAmount);
      cessAmount = round2(cessAmount + l.cessAmount);
      grandTotal = round2(grandTotal + l.lineTotal);
    }

    return { subtotal, discountAmount, taxableAmount, cgstAmount, sgstAmount, igstAmount, cessAmount, grandTotal };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
