import type { TenantScopedDatabase } from '@erp/sdk';
import { GstLedgerService } from './GstLedgerService.js';
import { createLogger } from '@erp/logger';

const logger = createLogger({ serviceName: 'gst-service' });

export interface Gstr3bTable31 {
  // 3.1(a) — Outward taxable supplies (other than zero rated, nil and exempted)
  outwardTaxable: { igst: number; cgst: number; sgst: number; cess: number; taxableValue: number };
  // 3.1(b) — Outward taxable supplies (zero rated)
  outwardZeroRated: { igst: number; taxableValue: number };
  // 3.1(c) — Other outward supplies (nil rated, exempted)
  outwardOther: { taxableValue: number };
  // 3.1(d) — Inward supplies (liable to reverse charge)
  inwardRcm: { igst: number; cgst: number; sgst: number; cess: number; taxableValue: number };
  // 3.1(e) — Non-GST outward supplies
  outwardNonGst: { taxableValue: number };
}

export interface Gstr3bTable4 {
  // 4(A) — ITC available
  itcAvailable: {
    importOfGoods: { igst: number; cgst: number; sgst: number; cess: number };
    importOfServices: { igst: number };
    inwardSupplies: { igst: number; cgst: number; sgst: number; cess: number }; // 4A(5) — all other ITC
    rcm: { igst: number; cgst: number; sgst: number; cess: number };
    total: { igst: number; cgst: number; sgst: number; cess: number };
  };
  // 4(B) — ITC reversed
  itcReversed: { rule42_43: { igst: number; cgst: number; sgst: number; cess: number } };
  // 4(C) — Net ITC available
  netItcAvailable: { igst: number; cgst: number; sgst: number; cess: number };
}

export interface ItcSetoff {
  // Liability before set-off
  igstLiability: number;
  cgstLiability: number;
  sgstLiability: number;
  // ITC available
  igstItc: number;
  cgstItc: number;
  sgstItc: number;
  // Set-off order per GST rules
  setoff: {
    // IGST liability set-off
    igstFromIgst: number;
    igstFromCgst: number;
    igstFromSgst: number;
    // CGST liability set-off
    cgstFromIgst: number;
    cgstFromCgst: number;
    // SGST liability set-off
    sgstFromIgst: number;
    sgstFromSgst: number;
  };
  // Cash required after ITC set-off
  cashRequired: { igst: number; cgst: number; sgst: number };
  // Balance ITC after set-off
  balanceItc: { igst: number; cgst: number; sgst: number };
}

export interface Gstr3bResult {
  period: string;
  table31: Gstr3bTable31;
  table4: Gstr3bTable4;
  itcSetoff: ItcSetoff;
}

export class Gstr3bService {
  static async compute(
    db: TenantScopedDatabase,
    tenantId: number,
    period: string
  ): Promise<Gstr3bResult> {
    logger.info({ tenantId, period }, 'Computing GSTR-3B');

    const summary = await GstLedgerService.getSummary(db, tenantId, period);

    // ── Table 3.1 — Outward supplies ─────────────────────────────────────────
    const netCgst = summary.sales.cgst - summary.creditNotes.cgst;
    const netSgst = summary.sales.sgst - summary.creditNotes.sgst;
    const netIgst = summary.sales.igst - summary.creditNotes.igst;
    const netTaxable = summary.sales.taxable - summary.creditNotes.taxable;

    const table31: Gstr3bTable31 = {
      outwardTaxable: {
        igst: Math.max(0, netIgst),
        cgst: Math.max(0, netCgst),
        sgst: Math.max(0, netSgst),
        cess: Math.max(0, summary.sales.cess),
        taxableValue: Math.max(0, netTaxable),
      },
      outwardZeroRated: { igst: 0, taxableValue: 0 },
      outwardOther: { taxableValue: 0 },
      inwardRcm: { igst: 0, cgst: 0, sgst: 0, cess: 0, taxableValue: 0 },
      outwardNonGst: { taxableValue: 0 },
    };

    // ── Table 4 — ITC ────────────────────────────────────────────────────────
    // Net ITC = purchases - purchase returns, for eligible entries only
    const netItcCgst = summary.purchases.cgst - summary.purchaseReturns.cgst;
    const netItcSgst = summary.purchases.sgst - summary.purchaseReturns.sgst;
    const netItcIgst = summary.purchases.igst - summary.purchaseReturns.igst;

    const table4: Gstr3bTable4 = {
      itcAvailable: {
        importOfGoods: { igst: 0, cgst: 0, sgst: 0, cess: 0 },
        importOfServices: { igst: 0 },
        inwardSupplies: {
          igst: Math.max(0, netItcIgst),
          cgst: Math.max(0, netItcCgst),
          sgst: Math.max(0, netItcSgst),
          cess: 0,
        },
        rcm: { igst: 0, cgst: 0, sgst: 0, cess: 0 },
        total: {
          igst: Math.max(0, netItcIgst),
          cgst: Math.max(0, netItcCgst),
          sgst: Math.max(0, netItcSgst),
          cess: 0,
        },
      },
      itcReversed: { rule42_43: { igst: 0, cgst: 0, sgst: 0, cess: 0 } },
      netItcAvailable: {
        igst: Math.max(0, netItcIgst),
        cgst: Math.max(0, netItcCgst),
        sgst: Math.max(0, netItcSgst),
        cess: 0,
      },
    };

    // ── ITC Set-off (strict GST rule order) ───────────────────────────────────
    const itcSetoff = Gstr3bService.computeItcSetoff(
      { igst: table31.outwardTaxable.igst, cgst: table31.outwardTaxable.cgst, sgst: table31.outwardTaxable.sgst },
      { igst: table4.netItcAvailable.igst, cgst: table4.netItcAvailable.cgst, sgst: table4.netItcAvailable.sgst }
    );

    return { period, table31, table4, itcSetoff };
  }

  /**
   * ITC Set-off algorithm per GST Rules:
   * IGST liability: IGST ITC → CGST ITC → SGST ITC
   * CGST liability: IGST ITC (remaining) → CGST ITC  [NEVER SGST ITC]
   * SGST liability: IGST ITC (remaining) → SGST ITC  [NEVER CGST ITC]
   */
  static computeItcSetoff(
    liability: { igst: number; cgst: number; sgst: number },
    itcAvailable: { igst: number; cgst: number; sgst: number }
  ): ItcSetoff {
    let igstItcBal = itcAvailable.igst;
    let cgstItcBal = itcAvailable.cgst;
    let sgstItcBal = itcAvailable.sgst;

    let igstLiabilityRemaining = liability.igst;

    // Step 1: IGST liability — use IGST ITC first
    const igstFromIgst = Math.min(igstLiabilityRemaining, igstItcBal);
    igstItcBal -= igstFromIgst;
    igstLiabilityRemaining -= igstFromIgst;

    // Step 2: IGST liability — use CGST ITC if IGST ITC exhausted
    const igstFromCgst = Math.min(igstLiabilityRemaining, cgstItcBal);
    cgstItcBal -= igstFromCgst;
    igstLiabilityRemaining -= igstFromCgst;

    // Step 3: IGST liability — use SGST ITC if still remaining
    const igstFromSgst = Math.min(igstLiabilityRemaining, sgstItcBal);
    sgstItcBal -= igstFromSgst;
    igstLiabilityRemaining -= igstFromSgst;

    let cgstLiabilityRemaining = liability.cgst;

    // Step 4: CGST liability — use remaining IGST ITC
    const cgstFromIgst = Math.min(cgstLiabilityRemaining, igstItcBal);
    igstItcBal -= cgstFromIgst;
    cgstLiabilityRemaining -= cgstFromIgst;

    // Step 5: CGST liability — use CGST ITC  [NEVER SGST ITC]
    const cgstFromCgst = Math.min(cgstLiabilityRemaining, cgstItcBal);
    cgstItcBal -= cgstFromCgst;
    cgstLiabilityRemaining -= cgstFromCgst;

    let sgstLiabilityRemaining = liability.sgst;

    // Step 6: SGST liability — use remaining IGST ITC
    const sgstFromIgst = Math.min(sgstLiabilityRemaining, igstItcBal);
    igstItcBal -= sgstFromIgst;
    sgstLiabilityRemaining -= sgstFromIgst;

    // Step 7: SGST liability — use SGST ITC  [NEVER CGST ITC]
    const sgstFromSgst = Math.min(sgstLiabilityRemaining, sgstItcBal);
    sgstItcBal -= sgstFromSgst;
    sgstLiabilityRemaining -= sgstFromSgst;

    return {
      igstLiability: liability.igst,
      cgstLiability: liability.cgst,
      sgstLiability: liability.sgst,
      igstItc: itcAvailable.igst,
      cgstItc: itcAvailable.cgst,
      sgstItc: itcAvailable.sgst,
      setoff: {
        igstFromIgst,
        igstFromCgst,
        igstFromSgst,
        cgstFromIgst,
        cgstFromCgst,
        sgstFromIgst,
        sgstFromSgst,
      },
      cashRequired: {
        igst: round2(igstLiabilityRemaining),
        cgst: round2(cgstLiabilityRemaining),
        sgst: round2(sgstLiabilityRemaining),
      },
      balanceItc: {
        igst: round2(igstItcBal),
        cgst: round2(cgstItcBal),
        sgst: round2(sgstItcBal),
      },
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
