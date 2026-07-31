// GSTCalculator — auto-switches IGST vs CGST+SGST based on interstate flag
//
// 2026-07-31 audit consolidation: the actual CGST/SGST/IGST/CESS split math (previously
// reimplemented here independently, byte-for-byte the same computation as
// sales/purchase/production-service's own copies) now delegates to the one shared primitive
// in @erp/utils. This module keeps its own input/output shape (pre-computed taxableAmount +
// isInterstate boolean, no discount handling) since it serves a genuinely different caller —
// RCM self-assessment on an already-known taxable amount, not a line-item discount+tax
// calculation — see @erp/utils's own header comment for the sales/purchase discount-formula
// divergence this consolidation fixed.
import { splitGstTax } from '@erp/utils';

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
  static calculateRCMTax(
    baseAmount: number,
    gstRate: number,
    isInterstate: boolean
  ): GSTComputeResult {
    return GSTCalculator.compute({ taxableAmount: baseAmount, gstRate, isInterstate });
  }

  static compute(input: GSTComputeInput): GSTComputeResult {
    const { taxableAmount, gstRate, cessRate, isInterstate } = input;
    const split = splitGstTax({ taxableAmount, gstRate, cessRate, isInterstate });
    const grandTotal = round2(taxableAmount + split.totalGst + split.cessAmount);

    return {
      taxableAmount,
      gstRate,
      cgstRate: split.cgstRate,
      sgstRate: split.sgstRate,
      igstRate: split.igstRate,
      cgstAmount: split.cgstAmount,
      sgstAmount: split.sgstAmount,
      igstAmount: split.igstAmount,
      cessAmount: split.cessAmount,
      totalGst: split.totalGst,
      grandTotal,
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
