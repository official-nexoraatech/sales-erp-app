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

// PG-040 — the real per-period cash/ITC discharge figures, persisted into
// gst_return_filings.filingData when a GSTR-3B period is marked filed (see
// GstReturnTrackerService.markFiled), so GSTR-9 Table 9 can later report actual tax
// paid instead of mirroring Table 4's liability figure.
export interface Gstr3bDischargeData {
  cashRequired: { igst: number; cgst: number; sgst: number };
  itcUtilized: { igst: number; cgst: number; sgst: number };
}

// Manual entry — NOT computed from ledger data. No schema field distinguishes import
// purchases from domestic ones (no country/isImport/customs field anywhere), so these two
// GSTR-3B sub-buckets stay at zero unless a user enters the real figure before filing (PG-039).
export interface Gstr3bManualAdjustments {
  importOfGoodsIgst?: number | undefined;
  importOfServicesIgst?: number | undefined;
}

export class Gstr3bService {
  static async compute(
    db: TenantScopedDatabase,
    tenantId: number,
    period: string,
    manualAdjustments?: Gstr3bManualAdjustments
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
      // Self-assessed output tax on RCM purchases (buyer stands in for the unregistered
      // supplier) — the same amount is claimed back as ITC below in table4.itcAvailable.rcm.
      inwardRcm: {
        igst: summary.rcm.igst,
        cgst: summary.rcm.cgst,
        sgst: summary.rcm.sgst,
        cess: summary.rcm.cess,
        taxableValue: summary.rcm.taxable,
      },
      outwardNonGst: { taxableValue: 0 },
    };

    // ── Table 4 — ITC ────────────────────────────────────────────────────────
    // Net ITC = purchases - purchase returns, for eligible entries only
    const netItcCgst = summary.purchases.cgst - summary.purchaseReturns.cgst;
    const netItcSgst = summary.purchases.sgst - summary.purchaseReturns.sgst;
    const netItcIgst = summary.purchases.igst - summary.purchaseReturns.igst;

    const inwardSupplies = {
      igst: Math.max(0, netItcIgst),
      cgst: Math.max(0, netItcCgst),
      sgst: Math.max(0, netItcSgst),
      cess: 0,
    };
    // Import-of-goods/services stay zero unless a manual adjustment was entered for this
    // period — see Gstr3bManualAdjustments. Imports attract IGST only.
    const importOfGoods = { igst: manualAdjustments?.importOfGoodsIgst ?? 0, cgst: 0, sgst: 0, cess: 0 };
    const importOfServices = { igst: manualAdjustments?.importOfServicesIgst ?? 0 };
    const rcm = { igst: summary.rcm.igst, cgst: summary.rcm.cgst, sgst: summary.rcm.sgst, cess: summary.rcm.cess };

    const itcAvailableTotal = {
      igst: inwardSupplies.igst + importOfGoods.igst + importOfServices.igst + rcm.igst,
      cgst: inwardSupplies.cgst + importOfGoods.cgst + rcm.cgst,
      sgst: inwardSupplies.sgst + importOfGoods.sgst + rcm.sgst,
      cess: inwardSupplies.cess + importOfGoods.cess + rcm.cess,
    };

    // Blocked-credit component only (entryType='PURCHASE' AND itcEligible=false) — mirrors
    // GSTR9Engine.ts Table 7's ineligible-purchase definition for cross-return consistency.
    // Rule 42/43's proportional exempt-ratio reversal is NOT computed here — this system has
    // no exempt-vs-taxable turnover-ratio engine. See PG-039 for the full scoping rationale.
    const itcReversed = {
      rule42_43: {
        igst: summary.ineligiblePurchases.igst,
        cgst: summary.ineligiblePurchases.cgst,
        sgst: summary.ineligiblePurchases.sgst,
        cess: summary.ineligiblePurchases.cess,
      },
    };

    const table4: Gstr3bTable4 = {
      itcAvailable: {
        importOfGoods,
        importOfServices,
        inwardSupplies,
        rcm,
        total: itcAvailableTotal,
      },
      itcReversed,
      netItcAvailable: {
        igst: Math.max(0, itcAvailableTotal.igst - itcReversed.rule42_43.igst),
        cgst: Math.max(0, itcAvailableTotal.cgst - itcReversed.rule42_43.cgst),
        sgst: Math.max(0, itcAvailableTotal.sgst - itcReversed.rule42_43.sgst),
        cess: Math.max(0, itcAvailableTotal.cess - itcReversed.rule42_43.cess),
      },
    };

    // ── ITC Set-off (strict GST rule order) ───────────────────────────────────
    // RCM liability feeds set-off alongside ordinary outward supply — a display-only fix
    // that didn't reach cashRequired would leave the cash-liability figure silently wrong.
    const itcSetoff = Gstr3bService.computeItcSetoff(
      {
        igst: table31.outwardTaxable.igst + table31.inwardRcm.igst,
        cgst: table31.outwardTaxable.cgst + table31.inwardRcm.cgst,
        sgst: table31.outwardTaxable.sgst + table31.inwardRcm.sgst,
      },
      { igst: table4.netItcAvailable.igst, cgst: table4.netItcAvailable.cgst, sgst: table4.netItcAvailable.sgst }
    );

    return { period, table31, table4, itcSetoff };
  }

  // PG-040 — derive the real "tax paid" figures from a computed set-off. itcUtilized sums
  // setoff by ITC source (not by liability head) — e.g. total IGST ITC utilized is however
  // much of the IGST ITC pool got drawn down, whether it paid IGST, CGST, or SGST liability.
  static deriveDischargeData(itcSetoff: ItcSetoff): Gstr3bDischargeData {
    const { setoff, cashRequired } = itcSetoff;
    return {
      cashRequired,
      itcUtilized: {
        igst: round2(setoff.igstFromIgst + setoff.cgstFromIgst + setoff.sgstFromIgst),
        cgst: round2(setoff.igstFromCgst + setoff.cgstFromCgst),
        sgst: round2(setoff.igstFromSgst + setoff.sgstFromSgst),
      },
    };
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
