// GSTCalculator — auto-switches IGST vs CGST+SGST based on interstate flag

export interface GSTComputeInput {
  taxableAmount: number;
  gstRate: number;
  cessRate?: number;
  isInterstate: boolean;
}

export interface GSTComputeResult {
  taxableAmount: number;
  gstRate: number;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  cessAmount: number;
  totalGst: number;
  grandTotal: number;
}

export class GSTCalculator {
  // RCM: buyer self-assesses GST on purchases from unregistered vendors and pays it
  // directly to the government instead of to the supplier (ES-10).
  static calculateRCMTax(baseAmount: number, gstRate: number, isInterstate: boolean): GSTComputeResult {
    return GSTCalculator.compute({ taxableAmount: baseAmount, gstRate, isInterstate });
  }

  static compute(input: GSTComputeInput): GSTComputeResult {
    const { taxableAmount, gstRate, cessRate = 0, isInterstate } = input;
    const halfRate = gstRate / 2;

    let cgstRate = 0;
    let sgstRate = 0;
    let igstRate = 0;
    let cgstAmount = 0;
    let sgstAmount = 0;
    let igstAmount = 0;

    if (isInterstate) {
      igstRate = gstRate;
      igstAmount = round2(taxableAmount * (gstRate / 100));
    } else {
      cgstRate = halfRate;
      sgstRate = halfRate;
      cgstAmount = round2(taxableAmount * (halfRate / 100));
      sgstAmount = round2(taxableAmount * (halfRate / 100));
    }

    const cessAmount = round2(taxableAmount * (cessRate / 100));
    const totalGst = cgstAmount + sgstAmount + igstAmount;
    const grandTotal = taxableAmount + totalGst + cessAmount;

    return {
      taxableAmount,
      gstRate,
      cgstRate,
      sgstRate,
      igstRate,
      cgstAmount,
      sgstAmount,
      igstAmount,
      cessAmount,
      totalGst,
      grandTotal: round2(grandTotal),
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
