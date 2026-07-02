export interface GSTLineInput {
  unitPrice: number;
  quantity: number;
  discountPct: number;
  discountAmount: number;
  gstRate: number;
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
  lineTotal: number;
}

export interface GSTTotals {
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  grandTotal: number;
}

export class GSTCalculator {
  static computeLine(input: GSTLineInput): GSTLineResult {
    const subtotal = Math.round(input.unitPrice * input.quantity * 100) / 100;
    const lineDiscountPct = (input.discountPct / 100) * subtotal;
    const discountAmount = Math.round(Math.max(input.discountAmount, lineDiscountPct) * 100) / 100;
    const taxableAmount = Math.round((subtotal - discountAmount) * 100) / 100;

    const isIntrastate = input.sellerStateCode === input.placeOfSupply;
    const cgstRate = isIntrastate ? input.gstRate / 2 : 0;
    const sgstRate = isIntrastate ? input.gstRate / 2 : 0;
    const igstRate = isIntrastate ? 0 : input.gstRate;

    const cgstAmount = Math.round((taxableAmount * cgstRate) / 100 * 100) / 100;
    const sgstAmount = Math.round((taxableAmount * sgstRate) / 100 * 100) / 100;
    const igstAmount = Math.round((taxableAmount * igstRate) / 100 * 100) / 100;
    const lineTotal = Math.round((taxableAmount + cgstAmount + sgstAmount + igstAmount) * 100) / 100;

    return {
      subtotal,
      discountAmount,
      taxableAmount,
      gstRate: input.gstRate,
      cgstRate,
      sgstRate,
      igstRate,
      cgstAmount,
      sgstAmount,
      igstAmount,
      lineTotal,
    };
  }

  static sumTotals(lines: GSTLineResult[]): GSTTotals {
    const subtotal = lines.reduce((s, l) => s + l.subtotal, 0);
    const discountAmount = lines.reduce((s, l) => s + l.discountAmount, 0);
    const taxableAmount = lines.reduce((s, l) => s + l.taxableAmount, 0);
    const cgstAmount = lines.reduce((s, l) => s + l.cgstAmount, 0);
    const sgstAmount = lines.reduce((s, l) => s + l.sgstAmount, 0);
    const igstAmount = lines.reduce((s, l) => s + l.igstAmount, 0);
    const grandTotal = taxableAmount + cgstAmount + sgstAmount + igstAmount;
    return { subtotal, discountAmount, taxableAmount, cgstAmount, sgstAmount, igstAmount, grandTotal };
  }
}
